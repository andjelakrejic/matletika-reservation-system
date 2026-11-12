import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service.js';
import { TIMEZONE } from '../config.js';
import { NotificationsService } from './notifications.service.js';

@Injectable()
export class RemindersService {
  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  // Every 5 minutes: remind students whose confirmed booking starts within the next hour
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sendReminders() {
    const now = new Date();
    const inOneHour = new Date(now.getTime() + 60 * 60_000);

    const due = await this.prisma.booking.findMany({
      where: {
        status: 'CONFIRMED',
        reminderSentAt: null,
        studentId: { not: null },
        startAt: { gt: now, lte: inOneHour },
      },
      include: { student: { select: { id: true, pushToken: true } } },
    });

    for (const b of due) {
      if (b.student) {
        const time = DateTime.fromJSDate(b.startAt, { zone: TIMEZONE }).toFormat('HH:mm');
        await this.notifications.send(b.student, 'Reminder', `Class starts at ${time}.`, { bookingId: b.id });
      }
      // Mark as handled even without a token, so the same booking is not picked up again
      await this.prisma.booking.update({ where: { id: b.id }, data: { reminderSentAt: new Date() } });
    }
  }
}