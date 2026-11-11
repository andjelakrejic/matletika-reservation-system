import { BadRequestException, Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service.js';
import { CAPACITY, SLOT_MINUTES, TIMEZONE } from '../config.js';

export interface Slot {
  hour: string;        // "16:30" (lokalno vreme)
  startAt: string;     // ISO, UTC, ovo se salje pri rezervaciji
  free: number;        // slobodna mesta u tom bloku od 30 min
  capacity: number;
  maxHours: 0 | 1 | 2; // najduza rezervacija koja može da počne ovde
}

@Injectable()
export class SlotsService {
  constructor(private prisma: PrismaService) {}

  async forDate(date: string): Promise<Slot[]> {
    const day = DateTime.fromISO(date, { zone: TIMEZONE }).startOf('day');
    if (!day.isValid) throw new BadRequestException('Neispravan datum');

    const dayStart = day.toJSDate();
    const dayEnd = day.plus({ days: 1 }).toJSDate();
    const weekday = day.weekday % 7;

    const [availability, timeOff, bookings] = await Promise.all([
      this.prisma.availability.findMany({ where: { weekday } }),
      this.prisma.timeOff.findMany({ where: { startAt: { lt: dayEnd }, endAt: { gt: dayStart } } }),
      this.prisma.booking.findMany({
        where: { status: { not: 'CANCELLED' }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
      }),
    ]);

    const step = SLOT_MINUTES * 60_000;
    const nowMs = DateTime.now().toMillis();
    const blocks = new Map<number, { start: DateTime; free: number }>();

    for (const a of availability) {
      const [sh, sm] = a.startTime.split(':').map(Number);
      const [eh, em] = a.endTime.split(':').map(Number);
      let start = day.set({ hour: sh, minute: sm });
      const end = day.set({ hour: eh, minute: em });

      while (start.plus({ minutes: SLOT_MINUTES }) <= end) {
        const s = start.toMillis();
        const e = s + step;
        const blocked = timeOff.some((t) => t.startAt.getTime() < e && t.endAt.getTime() > s);
        if (!blocked && s > nowMs) {
          const taken = bookings.filter((b) => b.startAt.getTime() < e && b.endAt.getTime() > s).length;
          blocks.set(s, { start, free: Math.max(0, CAPACITY - taken) });
        }
        start = start.plus({ minutes: SLOT_MINUTES });
      }
    }

    const has = (ms: number) => (blocks.get(ms)?.free ?? 0) > 0;

    return [...blocks.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([ms, b]) => {
        const oneHour = has(ms) && has(ms + step);
        const twoHours = oneHour && has(ms + 2 * step) && has(ms + 3 * step);
        return {
          hour: b.start.toFormat('HH:mm'),
          startAt: b.start.toUTC().toISO()!,
          free: b.free,
          capacity: CAPACITY,
          maxHours: (twoHours ? 2 : oneHour ? 1 : 0) as 0 | 1 | 2,
        };
      });
  }
}