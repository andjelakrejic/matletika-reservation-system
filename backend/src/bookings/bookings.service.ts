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

    async create(userId: number, dto: CreateBookingDto) {
        const start = DateTime.fromISO(dto.startAt, { zone: TIMEZONE });

        // ovo treba u frontu da se ne omoguci
        if (!start.isValid || ![0, 30].includes(start.minute) || start.second !== 0)
            throw new BadRequestException('The reservation has to start in the full hour or half hour.');
        if (dto.schoolLevel === 'SECONDARY' && dto.grade > 4)
            throw new BadRequestException('Secondary school has grades 1-4');

        const offered = new Set((await this.slots.forDate(start.toFormat('yyyy-MM-dd'))).map((s) => s.startAt));
        for (let i = 0; i < dto.hours * 2; i++) {
        if (!offered.has(start.plus({ minutes: SLOT_MINUTES * i }).toUTC().toISO()!))
            throw new BadRequestException('Slot is not available');
        }

        const end = start.plus({ hours: dto.hours });
        const dayStart = start.startOf('day');
        const dayEnd = dayStart.plus({ days: 1 });
        const lockKey = Math.floor(dayStart.toMillis() / 86_400_000);

        return this.prisma.$transaction(async (tx) => {
            // jedna rezervacija po danu istovremeno, da dvoje ne uzmu poslednje mesto
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;

            await this.assertCapacity(tx, start, dto.hours);
            const overlapping = await tx.booking.count({
                where: {
                studentId: userId,
                status: { not: 'CANCELLED' },
                startAt: { lt: end.toJSDate() },
                endAt: { gt: start.toJSDate() },
                },
            });
            if (overlapping > 0) throw new ConflictException('You already have a reservation at this time.');

            const agg = await tx.booking.aggregate({
                _sum: { hours: true },
                where: {
                studentId: userId,
                status: { not: 'CANCELLED' },
                startAt: { gte: dayStart.toJSDate(), lt: dayEnd.toJSDate() },
                },
            });
            if ((agg._sum.hours ?? 0) + dto.hours > MAX_HOURS_PER_DAY)
                throw new ConflictException(`Maximum is ${MAX_HOURS_PER_DAY}h per day.`);   
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

        // Tell the student when the professor cancelled their booking
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
        if (!start.isValid || start.minute !== 0 || start.second !== 0)
            throw new BadRequestException('Termin mora počinjati na pun sat'); // pazi - sad je na pola sata
        const lockKey = Math.floor(start.startOf('day').toMillis() / 86_400_000);

        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;
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