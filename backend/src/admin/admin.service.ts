import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service.js';
import { CAPACITY, TIMEZONE } from '../config.js';
import { AvailabilityItemDto, CreateTimeOffDto } from './dtos.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const STUDENT_SELECT = { id: true, firstName: true, lastName: true, email: true } as const;

// deleteAccount

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  getAllBookings(status?: string) {
    if (status && !['PENDING', 'CONFIRMED', 'CANCELLED'].includes(status))
      throw new BadRequestException('Unknown status');
    return this.prisma.booking.findMany({
      where: status ? { status: status as 'PENDING' | 'CONFIRMED' | 'CANCELLED' } : {},
      include: { student: { select: STUDENT_SELECT } },
      orderBy: { startAt: 'asc' },
    });
  }

  async setBookingStatus(id: number, status: 'CONFIRMED' | 'CANCELLED') {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('Booking not found');
    
    if (status === 'CONFIRMED' && booking.status !== 'PENDING')
      throw new BadRequestException('Only a pending booking can be confirmed');

    if (booking.status === 'CANCELLED')
      throw new BadRequestException('Booking is already cancelled');

    const { student, ...updated } = await this.prisma.booking.update({
      where: { id },
      data: { status },
      include: { student: { select: { id: true, pushToken: true } } },
    });

    if (student) {
      const when = DateTime.fromJSDate(updated.startAt, { zone: TIMEZONE }).toFormat('dd.MM. HH:mm');
      await this.notifications.send(
        student,
        status === 'CONFIRMED' ? 'Booking confirmed' : 'Booking denied',
        when,
        { bookingId: id },
      );
    }
    return updated;
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
      for (let i = 0; i < b.hours * 2; i++) {
        const hs = DateTime.fromJSDate(b.startAt, { zone: TIMEZONE }).plus({ minutes: 30 * i });
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

  getAvailability() {
    return this.prisma.availability.findMany({ orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] });
  }

  // Zamenjuje celo radno vreme novom listom
  async setAvailability(items: AvailabilityItemDto[]) {
    const byDay = new Map<number, AvailabilityItemDto[]>();
    for (const i of items) {
      if (i.startTime >= i.endTime) throw new BadRequestException('The start has to be before the end.');
      byDay.set(i.weekday, [...(byDay.get(i.weekday) ?? []), i]);
    }
    for (const list of byDay.values()) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let k = 1; k < list.length; k++)
        if (list[k].startTime < list[k - 1].endTime) throw new BadRequestException('The reservations are overlapping.');
    }

    await this.prisma.$transaction([
      this.prisma.availability.deleteMany(),
      this.prisma.availability.createMany({ data: items }),
    ]);
    return this.getAvailability();
  }

  getTimeOff() {
    return this.prisma.timeOff.findMany({ where: { endAt: { gt: new Date() } }, orderBy: { startAt: 'asc' } });
  }

  async createTimeOff(dto: CreateTimeOffDto) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (!(startAt < endAt)) throw new BadRequestException('The start has to be before the end.');

    const timeOff = await this.prisma.timeOff.create({ data: { startAt, endAt } });
    // rezervacije koje već postoje u tom periodu se ne otkazuju same, profesorka ih otkazuje ručno
    const affectedBookings = await this.prisma.booking.count({
      where: { status: { not: 'CANCELLED' }, startAt: { lt: endAt }, endAt: { gt: startAt } },
    });
    return { timeOff, affectedBookings };
  }

  async deleteTimeOff(id: number) {
    const { count } = await this.prisma.timeOff.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException("This day for time off doesn't exist.");
    return { ok: true };
  }

}