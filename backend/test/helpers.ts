import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import { DateTime } from 'luxon';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { TIMEZONE } from '../src/config.js';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PRICE_PER_HOUR, CANCEL_DEADLINE_MS } from '../src/config.js';

export const PASSWORD = 'Password123!';

export interface SentMail {
  to: string;
  subject: string;
  text: string;
}

export interface TestCtx {
  app: INestApplication;
  prisma: PrismaService;
  mails: SentMail[];
}

/** Boots the real app, with the mail service replaced by a recorder. */
export async function createTestApp(): Promise<TestCtx> {
  const mails: SentMail[] = [];
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({
      send: async (to: string, subject: string, text: string) => {
        mails.push({ to, subject, text });
      },
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, prisma: app.get(PrismaService), mails };
}

export async function resetDb(prisma: PrismaService) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "PasswordReset", "Booking", "Availability", "TimeOff", "User" RESTART IDENTITY CASCADE',
  );
}

export const http = (ctx: TestCtx) => request(ctx.app.getHttpServer());
export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
export const isOk = (status: number) => status >= 200 && status < 300;

let counter = 0;

export async function createUser(
  ctx: TestCtx,
  opts: {
    email?: string;
    role?: 'STUDENT' | 'PROFESSOR';
    firstName?: string;
    lastName?: string;
    pushToken?: string;
  } = {},
) {
  counter += 1;
  return ctx.prisma.user.create({
    data: {
      firstName: opts.firstName ?? 'Test',
      lastName: opts.lastName ?? `User${counter}`,
      email: opts.email ?? `user${counter}@test.com`,
      password: await bcrypt.hash(PASSWORD, 4),
      role: opts.role ?? 'STUDENT',
      pushToken: opts.pushToken,
    },
  });
}

export async function login(ctx: TestCtx, email: string, password = PASSWORD): Promise<string> {
  const res = await http(ctx).post('/auth/login').send({ email, password });
  if (!isOk(res.status)) throw new Error(`Login failed for ${email}: ${res.status}`);
  return res.body.token;
}

export async function createUserWithToken(ctx: TestCtx, opts: Parameters<typeof createUser>[1] = {}) {
  const user = await createUser(ctx, opts);
  const token = await login(ctx, user.email);
  return { user, token };
}

/** A working day in the future (at least `minDaysAhead` days from now), in the app's time zone. */
export function futureDay(isoWeekday = 1, minDaysAhead = 7) {
  let d = DateTime.now().setZone(TIMEZONE).startOf('day').plus({ days: minDaysAhead });
  while (d.weekday !== isoWeekday) d = d.plus({ days: 1 });

  const at = (time: string) => {
    const [hour, minute] = time.split(':').map(Number);
    return d.set({ hour, minute });
  };
  return {
    date: d.toFormat('yyyy-MM-dd'),
    weekday: d.weekday % 7, // 0 = Sunday, as stored in Availability
    at,
    iso: (time: string) => at(time).toUTC().toISO()!,
  };
}
export type Day = ReturnType<typeof futureDay>;

export function setWorkingHours(ctx: TestCtx, day: Day, startTime = '16:00', endTime = '20:00') {
  return ctx.prisma.availability.create({ data: { weekday: day.weekday, startTime, endTime } });
}

/** Valid POST /bookings body for a given day and start time. */
export function bookingBody(day: Day, time: string, hours = 1, overrides: Record<string, unknown> = {}) {
  return {
    startAt: day.iso(time),
    hours,
    schoolLevel: 'PRIMARY',
    grade: 7,
    topics: ['fractions'],
    ...overrides,
  };
}

/** Inserts a booking directly into the database (bypasses all API rules). */
export function makeBooking(
  ctx: TestCtx,
  o: {
    studentId?: number | null;
    guestName?: string;
    start: Date;
    hours?: number;
    status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  },
) {
  const hours = o.hours ?? 1;
  return ctx.prisma.booking.create({
    data: {
      studentId: o.studentId ?? null,
      guestName: o.guestName,
      startAt: o.start,
      endAt: new Date(o.start.getTime() + hours * 3_600_000),
      hours,
      price: hours * PRICE_PER_HOUR,
      status: o.status ?? 'CONFIRMED',
      schoolLevel: 'PRIMARY',
      grade: 5,
      topics: ['fractions'],
      createdBy: 'STUDENT',
    },
  });
}
