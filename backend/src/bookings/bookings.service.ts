import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { SlotsService } from "../slots/slots.service.js";
import { Prisma } from "../generated/prisma/client.js";
import { DateTime } from 'luxon'
import { CANCEL_DEADLINE_MS, CAPACITY, MAX_HOURS_PER_DAY, PRICE_PER_HOUR, TIMEZONE } from "../config.js";
import { CreateBookingDto } from "./dtos.js";


@Injectable()
export class BookingsService {

    constructor(private prisma: PrismaService, private slots: SlotsService) {}

    private async assertCapacity(tx: Prisma.TransactionClient, start: DateTime, hours: number) { // proverava da li u svakom satu trazenog termina ima slobodnih mesta 
        for (let i = 0; i < hours; i++) {
            const hs = start.plus({ hours: i });
            const taken = await tx.booking.count({ // broj zauzetih mesta 
                where: {
                    status: { not: 'CANCELLED' },
                    startAt: { lt: hs.plus({ hours: 1 }).toJSDate() },
                    endAt: { gt: hs.toJSDate() }
                }
            });
            if (taken >= CAPACITY) throw new ConflictException('This slot is already full.');
        }
    }

    async create(userId: number, dto: CreateBookingDto) {
        const start = DateTime.fromISO(dto.startAt, { zone: TIMEZONE });

        // ovo treba u frontu da se ne omoguci
        if (!start.isValid || start.minute !== 0 || start.second !== 0)
            throw new BadRequestException('The reservation has to start in the full hour');
        if (dto.schoolLevel === 'SECONDARY' && dto.grade > 4)
            throw new BadRequestException('Secondary school has grades 1-4');

        // provera da svaki trazeni sat postoji u ponudi (ne sme da bude u proslosti :| )
        const offeredHours = new Set((await this.slots.forDate(start.toFormat('yyyy-MM-dd'))).map((s) => s.startAt));
        for (let i = 0; i < dto.hours; i++) {
            if (!offeredHours.has(start.plus({ hours: i}).toUTC().toISO()!))
                throw new BadRequestException("This reservation time isn't available.")
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
                throw new ConflictException(`Maksimum je ${MAX_HOURS_PER_DAY}h po danu`);

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
        if (!booking) throw new NotFoundException('This reservation does not exist.');

        if (user.role === 'STUDENT') {
        if (booking.studentId !== user.id) throw new ForbiddenException();
        if (booking.startAt.getTime() - Date.now() < CANCEL_DEADLINE_MS)
            throw new ForbiddenException('You can only cancel up to 2h before your class.');
        }
        if (booking.status === 'CANCELLED') return booking;

        return this.prisma.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } });
    }

}