import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service.js';
import { CAPACITY, TIMEZONE } from '../config.js';

const STUDENT_SELECT = { id: true, firstName: true, lastName: true, email: true } as const;

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  getAllBookings(status?: string) {
    if (status && !['PENDING', 'CONFIRMED', 'CANCELLED'].includes(status))
      throw new BadRequestException('Unknown status');
    return this.prisma.booking.findMany({
      where: status ? { status: status as 'PENDING' | 'CONFIRMED' | 'CANCELLED' } : {},
      include: { student: { select: STUDENT_SELECT } },
      orderBy: { startAt: 'asc' },
    });
  }

  async setStatus(id: number, status: 'CONFIRMED' | 'CANCELLED') {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException("This reservation doesn't exist");
    if (status === 'CONFIRMED' && booking.status !== 'PENDING')
      throw new BadRequestException("You can only accept a pending reservation");
    return this.prisma.booking.update({ where: { id }, data: { status } });
  }

  async getSchedule(date: string) {
    const day = DateTime.fromISO(date, { zone: TIMEZONE }).startOf('day');
    if (!day.isValid) throw new BadRequestException('Invalid date');

    const bookings = await this.prisma.booking.findMany({
      where: {
        status: { not: 'CANCELLED' },
        startAt: { lt: day.plus({ days: 1 }).toJSDate() },
        endAt: { gt: day.toJSDate() },
      },
      include: { student: { select: STUDENT_SELECT } },
      orderBy: { startAt: 'asc' },
    });

    const byHour = new Map<string, { hour: string; startAt: string; capacity: number; entries: unknown[] }>();
    for (const b of bookings) {
      for (let i = 0; i < b.hours; i++) {
        const hs = DateTime.fromJSDate(b.startAt, { zone: TIMEZONE }).plus({ hours: i });
        const key = hs.toUTC().toISO()!;
        if (!byHour.has(key))
          byHour.set(key, { hour: hs.toFormat('HH:mm'), startAt: key, capacity: CAPACITY, entries: [] });
        byHour.get(key)!.entries.push({
          bookingId: b.id,
          name: b.student ? `${b.student.firstName} ${b.student.lastName}` : b.guestName,
          status: b.status,
          schoolLevel: b.schoolLevel,
          grade: b.grade,
          topics: b.topics,
          note: b.note,
        });
      }
    }
    return [...byHour.values()].sort((a, b) => a.startAt.localeCompare(b.startAt));
  }
}