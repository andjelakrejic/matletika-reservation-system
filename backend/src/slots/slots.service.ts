import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { CAPACITY, TIMEZONE } from "../config.js";
import { DateTime } from 'luxon';


export interface Slot {
    hour: string,       // "17:00"
    startAt: string,
    free: number,
    capacity: number,
}

@Injectable()
export class SlotsService {

    constructor(private prisma: PrismaService) {}

    async forDate(date: string) {
        const day = DateTime.fromISO(date, { zone: TIMEZONE }).startOf('day');
        if(!day.isValid) throw new BadRequestException("Invalid date");

        const dayStart = day.toJSDate();
        const dayEnd = day.plus({ days: 1 }).toJSDate();
        const weekday = day.weekday % 7; // Luxon: pon=1...ned=7 -> ours: pon=0

        const [availability, timeOff, bookings] = await Promise.all([
        this.prisma.availability.findMany({ where: { weekday } }),
        this.prisma.timeOff.findMany({ where: { startAt: { lt: dayEnd }, endAt: { gt: dayStart } } }),
        this.prisma.booking.findMany({
          where: { status: { not: 'CANCELLED' }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
        }),
      ]);

      const nowMs = DateTime.now().toMillis();
      const slots: Slot[] = [];

      for (const a of availability) {
        const [sh, sm] = a.startTime.split(':').map(Number);
        const [eh, em] = a.endTime.split(':').map(Number);
        let start = day.set({ hour: sh, minute: sm });
        const end = day.set({ hour: eh, minute: em });

        while (start.plus({ hours: 1 }) <= end) {
          const s = start.toMillis();
          const e = start.plus({ hours: 1 }).toMillis();

          const blocked = timeOff.some((t) => t.startAt.getTime() < e && t.endAt.getTime() > s);
          if (!blocked && s > nowMs) {
            const taken = bookings.filter((b) => b.startAt.getTime() < e && b.endAt.getTime() > s).length;
            slots.push({
              hour: start.toFormat('HH:mm'),
              startAt: start.toUTC().toISO()!,
              free: Math.max(0, CAPACITY - taken),
              capacity: CAPACITY,
            });
          }
          start = start.plus({ hours: 1 });
        }
      }

      return slots.sort((x, y) => x.startAt.localeCompare(y.startAt));
    }
}