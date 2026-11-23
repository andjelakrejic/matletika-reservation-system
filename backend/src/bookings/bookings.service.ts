import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { SlotsService } from "../slots/slots.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { DateTime } from 'luxon'
import { CANCEL_DEADLINE_MS, CAPACITY, MAX_HOURS_PER_DAY, PRICE_PER_HOUR, SLOT_MINUTES, TIMEZONE } from "../config.js";
import { CreateBookingDto, ManualBookingDto } from "./dtos.js";
import { NotificationsService } from "../notifications/notifications.service.js";


@Injectable()
export class BookingsService {

    constructor(private prisma: PrismaService, private slots: SlotsService, private notifications: NotificationsService) {}

    private async assertCapacity(tx: Prisma.TransactionClient, start: DateTime, hours: number) { // proverava da li u svakom satu trazenog termina ima slobodnih mesta 
        const blocks = hours * (60 / SLOT_MINUTES);
        for (let i = 0; i < blocks; i++) {
            const bs = start.plus({ minutes: SLOT_MINUTES * i });
            const taken = await tx.booking.count({
                where: {
                status: { not: 'CANCELLED' },
                startAt: { lt: bs.plus({ minutes: SLOT_MINUTES }).toJSDate() },
                endAt: { gt: bs.toJSDate() },
                },
            });
            if (taken >= CAPACITY) throw new ConflictException('Termin je pun');
        }
    }

    private async assertWorkingHours(tx: Prisma.TransactionClient, start: DateTime, hours: number) {
        const toMin = (t: string) => {
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
        };
        const startMin = start.hour * 60 + start.minute;
        const endMin = startMin + hours * 60;
        const end = start.plus({ hours });

        // luxon: 1 = ponedeljak ... 7 = nedelja; u bazi 0 = nedelja
        const windows = await tx.availability.findMany({ where: { weekday: start.weekday % 7 } });
        const inside = windows.some(
            (w) => startMin >= toMin(w.startTime) && endMin <= toMin(w.endTime),
        );
        if (!inside) throw new BadRequestException('Outside working hours');

        const timeOff = await tx.timeOff.findFirst({
            where: { startAt: { lt: end.toJSDate() }, endAt: { gt: start.toJSDate() } },
        });
        if (timeOff) throw new BadRequestException('Professor is off at that time');
    }

    private async assertStudentLimits(tx: Prisma.TransactionClient, studentId: number, start: DateTime, hours: number) {
        const end = start.plus({ hours });
        const active = { studentId, status: { not: 'CANCELLED' as const } };

        // 1. preklapanje sa njegovom drugom rezervacijom
        const overlap = await tx.booking.findFirst({
            where: {
                ...active,
                startAt: { lt: end.toJSDate() },
                endAt: { gt: start.toJSDate() },
            },
        });
        if (overlap) throw new ConflictException('Student already has a booking at that time');

        // 2. dnevni limit (dan po Europe/Belgrade)
        const dayStart = start.startOf('day');
        const dayEnd = dayStart.plus({ days: 1 });
        const { _sum } = await tx.booking.aggregate({
            _sum: { hours: true },
            where: {
                ...active,
                startAt: { gte: dayStart.toJSDate(), lt: dayEnd.toJSDate() },
            },
        });

        if ((_sum.hours ?? 0) + hours > MAX_HOURS_PER_DAY)
            throw new ConflictException(`Maximum is ${MAX_HOURS_PER_DAY}h per day`);
    }

    async create(userId: number, dto: CreateBookingDto) {
        const start = DateTime.fromISO(dto.startAt, { zone: TIMEZONE });

        if (
            !start.isValid ||
            ![0, 30].includes(start.minute) ||
            start.second !== 0 ||
            start.millisecond !== 0
        )
            throw new BadRequestException('The reservation has to start on the full hour or half hour.');
        if (start < DateTime.now())
            throw new BadRequestException('Cannot book in the past.');
        if (dto.schoolLevel === 'SECONDARY' && dto.grade > 4)
            throw new BadRequestException('Secondary school has grades 1-4');

        // rana provera protiv ponuđenih termina (može da zastari, zato se radno vreme i kapacitet proveravaju opet u transakciji)
        const offered = new Set(
            (await this.slots.forDate(start.toFormat('yyyy-MM-dd'))).map((s) => s.startAt),
        );
        for (let i = 0; i < dto.hours * 2; i++) {
            if (!offered.has(start.plus({ minutes: SLOT_MINUTES * i }).toUTC().toISO()!))
            throw new BadRequestException('Slot is not available');
        }

        const end = start.plus({ hours: dto.hours });
        const lockKey = Math.floor(start.startOf('day').toMillis() / 86_400_000);

        return this.prisma.$transaction(async (tx) => {
            // jedna rezervacija po danu istovremeno, da dvoje ne uzmu poslednje mesto
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;

            await this.assertWorkingHours(tx, start, dto.hours);
            await this.assertStudentLimits(tx, userId, start, dto.hours);
            await this.assertCapacity(tx, start, dto.hours);

            return tx.booking.create({
            data: {
                studentId: userId,
                startAt: start.toJSDate(),
                endAt: end.toJSDate(),
                hours: dto.hours,
                price: dto.hours * PRICE_PER_HOUR,
                schoolLevel: dto.schoolLevel,
                grade: dto.grade,
                topics: dto.topics,
                note: dto.note,
                createdBy: 'STUDENT',
            },
            });
        });
    }

    async cancel(user: { id: number; role: 'STUDENT' | 'PROFESSOR' }, bookingId: number) {
        const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking) throw new NotFoundException('Booking not found');

        if (user.role === 'STUDENT') {
            if (booking.studentId !== user.id) throw new ForbiddenException();
            if (booking.startAt.getTime() - Date.now() < CANCEL_DEADLINE_MS)
            throw new ForbiddenException('Cancellation is only possible at least 6 hours before the booking');
        }
        if (booking.status === 'CANCELLED') return booking;

        const { student, ...updated } = await this.prisma.booking.update({
            where: { id: bookingId },
            data: { status: 'CANCELLED' },
            include: { student: { select: { id: true, pushToken: true } } },
        });

        // Obavestava se student kad profseor otkaze termin
        if (user.role === 'PROFESSOR' && student) {
            const when = DateTime.fromJSDate(updated.startAt, { zone: TIMEZONE }).toFormat('dd.MM. HH:mm');
            await this.notifications.send(student, 'Booking cancelled', when, { bookingId });
        }
        return updated;
    }

    async createManualBooking(dto: ManualBookingDto) {
        if (!dto.studentId && !dto.guestName)
            throw new BadRequestException('Input student id or guest name');
        if (dto.studentId && !(await this.prisma.user.findUnique({ where: { id: dto.studentId } })))
            throw new BadRequestException('This student does not exist');

        const start = DateTime.fromISO(dto.startAt, { zone: TIMEZONE });
        if (!start.isValid || ![0, 30].includes(start.minute) || start.second !== 0 || start.millisecond !== 0)
            throw new BadRequestException('The reservation must begin on the hour or half hour');
        const lockKey = Math.floor(start.startOf('day').toMillis() / 86_400_000);

        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;
            await this.assertWorkingHours(tx, start, dto.hours);
            if (dto.studentId) await this.assertStudentLimits(tx, dto.studentId, start, dto.hours);
            await this.assertCapacity(tx, start, dto.hours);
            return tx.booking.create({
            data: {
                studentId: dto.studentId,
                guestName: dto.guestName,
                startAt: start.toJSDate(),
                endAt: start.plus({ hours: dto.hours }).toJSDate(),
                hours: dto.hours,
                price: dto.hours * PRICE_PER_HOUR,
                schoolLevel: dto.schoolLevel,
                grade: dto.grade,
                topics: dto.topics ?? [],
                note: dto.note,
                createdBy: 'PROFESSOR',
                status: 'CONFIRMED',
            },
            });
        });
    }

}