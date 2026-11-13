import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TestCtx, auth, bookingBody, createTestApp, createUserWithToken, futureDay, http, makeBooking, resetDb,
  setWorkingHours,
} from './helpers.js';

type Slot = { hour: string; free: number };

describe('Bookings', () => {
  let ctx: TestCtx;
  let student: Awaited<ReturnType<typeof createUserWithToken>>;
  const day = futureDay(1); // Monday
  const day2 = futureDay(3); // Wednesday

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await setWorkingHours(ctx, day, '16:00', '20:00');
    await setWorkingHours(ctx, day2, '16:00', '20:00');
    student = await createUserWithToken(ctx);
  });

  const book = (token: string, body: Record<string, unknown>) =>
    http(ctx).post('/bookings').set(auth(token)).send(body);
  const cancel = (token: string, id: number) => http(ctx).delete(`/bookings/${id}`).set(auth(token));
  const freeAt = async (time: string, d = day) => {
    const res = await http(ctx).get(`/slots?date=${d.date}`).set(auth(student.token)).expect(200);
    return (res.body as Slot[]).find((s) => s.hour === time)?.free;
  };

  describe('POST /bookings', () => {
    it('needs a token', async () => {
      await http(ctx).post('/bookings').send(bookingBody(day, '17:00')).expect(401);
    });

    it('creates a pending 1h booking with the right price and end time', async () => {
      const res = await book(student.token, bookingBody(day, '17:00', 1)).expect(201);
      expect(res.body).toMatchObject({
        status: 'PENDING', hours: 1, price: 500, studentId: student.user.id,
        schoolLevel: 'PRIMARY', grade: 7, topics: ['fractions'], createdBy: 'STUDENT',
      });
      expect(new Date(res.body.endAt).getTime() - new Date(res.body.startAt).getTime()).toBe(3_600_000);
    });

    it('creates a 2h booking priced at 1000', async () => {
      const res = await book(student.token, bookingBody(day, '17:00', 2)).expect(201);
      expect(res.body.price).toBe(1000);
      expect(new Date(res.body.endAt).getTime() - new Date(res.body.startAt).getTime()).toBe(7_200_000);
    });

    it('accepts a start at half past', async () => {
      await book(student.token, bookingBody(day, '17:30', 1)).expect(201);
    });

    it('takes a seat from every half-hour block it covers', async () => {
      await book(student.token, bookingBody(day, '17:30', 1)).expect(201); // 17:30-18:30
      expect(await freeAt('17:00')).toBe(3);
      expect(await freeAt('17:30')).toBe(2);
      expect(await freeAt('18:00')).toBe(2);
      expect(await freeAt('18:30')).toBe(3);
    });

    it('trims and de-duplicates the topics', async () => {
      const res = await book(
        student.token,
        bookingBody(day, '17:00', 1, { topics: [' fractions ', 'fractions', 'percent'] }),
      ).expect(201);
      expect(res.body.topics).toEqual(['fractions', 'percent']);
    });

    it('stores the optional note', async () => {
      const res = await book(student.token, bookingBody(day, '17:00', 1, { note: 'Test on Friday' })).expect(201);
      expect(res.body.note).toBe('Test on Friday');
    });

    describe('validation', () => {
      const invalid: [string, Record<string, unknown>][] = [
        ['hours = 0', { hours: 0 }],
        ['hours = 3', { hours: 3 }],
        ['hours = 1.5', { hours: 1.5 }],
        ['grade = 0', { grade: 0 }],
        ['grade = 9', { grade: 9 }],
        ['unknown school level', { schoolLevel: 'COLLEGE' }],
        ['secondary school grade 5', { schoolLevel: 'SECONDARY', grade: 5 }],
        ['no topics', { topics: [] }],
        ['4 topics', { topics: ['a1', 'b2', 'c3', 'd4'] }],
        ['one-letter topic', { topics: ['a'] }],
        ['start at :15', { startAt: futureDay(1).iso('17:15') }],
        ['start not a date', { startAt: 'tomorrow' }],
        ['note too long', { note: 'x'.repeat(201) }],
      ];

      it.each(invalid)('rejects %s', async (_name, override) => {
        await book(student.token, bookingBody(day, '17:00', 1, override)).expect(400);
      });

      it('accepts secondary school grades 1-4', async () => {
        await book(student.token, bookingBody(day, '17:00', 1, { schoolLevel: 'SECONDARY', grade: 4 })).expect(201);
      });
    });

    describe('availability rules', () => {
      it('rejects a start outside working hours', async () => {
        await book(student.token, bookingBody(day, '12:00')).expect(400);
        await book(student.token, bookingBody(day, '20:00')).expect(400);
      });

      it('rejects a booking that runs past the end of working hours', async () => {
        await book(student.token, bookingBody(day, '19:30', 1)).expect(400);
        await book(student.token, bookingBody(day, '19:00', 2)).expect(400);
        await book(student.token, bookingBody(day, '19:00', 1)).expect(201); // exactly until 20:00
      });

      it('rejects a day without working hours', async () => {
        await book(student.token, bookingBody(futureDay(2), '17:00')).expect(400);
      });

      it('rejects a booking in the past', async () => {
        await book(student.token, { ...bookingBody(day, '17:00'), startAt: '2020-01-06T16:00:00.000Z' }).expect(400);
      });

      it('rejects a time that is inside a day off', async () => {
        await ctx.prisma.timeOff.create({
          data: { startAt: day.at('17:00').toJSDate(), endAt: day.at('18:00').toJSDate() },
        });
        await book(student.token, bookingBody(day, '17:00', 1)).expect(400);
        await book(student.token, bookingBody(day, '16:30', 1)).expect(400); // would run into the day off
      });
    });

    describe('capacity', () => {
      it('allows 3 students per block and rejects the 4th', async () => {
        const others = [await createUserWithToken(ctx), await createUserWithToken(ctx), await createUserWithToken(ctx)];
        await book(student.token, bookingBody(day, '17:00')).expect(201);
        await book(others[0].token, bookingBody(day, '17:00')).expect(201);
        await book(others[1].token, bookingBody(day, '17:00')).expect(201);
        await book(others[2].token, bookingBody(day, '17:00')).expect(409);
        expect(await freeAt('17:00')).toBe(0);
      });

      it('rejects a 2h booking when the second hour is full', async () => {
        const others = [await createUserWithToken(ctx), await createUserWithToken(ctx), await createUserWithToken(ctx)];
        for (const o of others) await book(o.token, bookingBody(day, '18:00')).expect(201);
        await book(student.token, bookingBody(day, '17:00', 2)).expect(409); // the 18:00 block is full
        await book(student.token, bookingBody(day, '17:00', 1)).expect(201); // 17:00-18:00 is still free
      });

      it('counts overlapping bookings that start at different half hours', async () => {
        const others = [await createUserWithToken(ctx), await createUserWithToken(ctx), await createUserWithToken(ctx)];
        await book(others[0].token, bookingBody(day, '17:00')).expect(201); // 17:00-18:00
        await book(others[1].token, bookingBody(day, '17:30')).expect(201); // 17:30-18:30
        await book(others[2].token, bookingBody(day, '17:30')).expect(201); // 17:30-18:30 -> 17:30 block now 3/3
        await book(student.token, bookingBody(day, '17:00')).expect(409); // 17:00-18:00 hits the full 17:30 block
        await book(student.token, bookingBody(day, '16:00')).expect(201); // 16:00-17:00 is untouched
      });

      it('lets a seat be taken again after a cancellation', async () => {
        const others = [await createUserWithToken(ctx), await createUserWithToken(ctx), await createUserWithToken(ctx)];
        const first = await book(others[0].token, bookingBody(day, '17:00')).expect(201);
        await book(others[1].token, bookingBody(day, '17:00')).expect(201);
        await book(others[2].token, bookingBody(day, '17:00')).expect(201);
        await book(student.token, bookingBody(day, '17:00')).expect(409);

        await cancel(others[0].token, first.body.id).expect(200);
        await book(student.token, bookingBody(day, '17:00')).expect(201);
      });

      it('counts pending and confirmed bookings, but not cancelled ones', async () => {
        await makeBooking(ctx, { start: day.at('17:00').toJSDate(), status: 'PENDING' });
        await makeBooking(ctx, { start: day.at('17:00').toJSDate(), status: 'CONFIRMED' });
        await makeBooking(ctx, { start: day.at('17:00').toJSDate(), status: 'CANCELLED' });
        expect(await freeAt('17:00')).toBe(1);
        await book(student.token, bookingBody(day, '17:00')).expect(201);
      });

      it('never overbooks when many students book the last seats at once', async () => {
        const students = await Promise.all(Array.from({ length: 6 }, () => createUserWithToken(ctx)));
        const results = await Promise.all(students.map((s) => book(s.token, bookingBody(day, '17:00'))));

        expect(results.filter((r) => r.status === 201)).toHaveLength(3);
        expect(results.filter((r) => r.status === 409)).toHaveLength(3);
        expect(await ctx.prisma.booking.count({ where: { status: { not: 'CANCELLED' } } })).toBe(3);
      });

      it('never lets one student exceed the daily limit with parallel requests', async () => {
        const results = await Promise.all(
          ['16:00', '17:00', '18:00', '19:00'].map((t) => book(student.token, bookingBody(day, t, 1))),
        );
        expect(results.filter((r) => r.status === 201)).toHaveLength(2);
        const total = await ctx.prisma.booking.aggregate({ _sum: { hours: true }, where: { studentId: student.user.id } });
        expect(total._sum.hours).toBe(2);
      });
    });

    describe('per-student rules', () => {
      it('rejects a booking that overlaps the student own booking', async () => {
        await book(student.token, bookingBody(day, '16:00', 1)).expect(201);
        await book(student.token, bookingBody(day, '16:30', 1)).expect(409);
        await book(student.token, bookingBody(day, '16:00', 1)).expect(409); // same block twice
      });

      it('limits a student to 2 hours per day in total', async () => {
        await book(student.token, bookingBody(day, '16:00', 1)).expect(201);
        await book(student.token, bookingBody(day, '17:00', 1)).expect(201);
        await book(student.token, bookingBody(day, '18:00', 1)).expect(409);
      });

      it('rejects a 2h booking after 1h was already booked that day', async () => {
        await book(student.token, bookingBody(day, '16:00', 1)).expect(201);
        await book(student.token, bookingBody(day, '17:00', 2)).expect(409);
      });

      it('applies the limit per day, not overall', async () => {
        await book(student.token, bookingBody(day, '16:00', 2)).expect(201);
        await book(student.token, bookingBody(day2, '16:00', 2)).expect(201);
      });

      it('does not count cancelled bookings towards the daily limit', async () => {
        const first = await book(student.token, bookingBody(day, '16:00', 2)).expect(201);
        await book(student.token, bookingBody(day, '18:00', 1)).expect(409);
        await cancel(student.token, first.body.id).expect(200);
        await book(student.token, bookingBody(day, '18:00', 2)).expect(201);
      });

      it('lets different students book the same time', async () => {
        const other = await createUserWithToken(ctx);
        await book(student.token, bookingBody(day, '17:00')).expect(201);
        await book(other.token, bookingBody(day, '17:00')).expect(201);
      });
    });
  });

  describe('DELETE /bookings/:id', () => {
    const HOUR = 3_600_000;

    it('needs a token', async () => {
      await http(ctx).delete('/bookings/1').expect(401);
    });

    it('lets a student cancel their own booking more than 2h ahead', async () => {
      const created = await book(student.token, bookingBody(day, '17:00')).expect(201);
      const res = await cancel(student.token, created.body.id).expect(200);
      expect(res.body.status).toBe('CANCELLED');
      expect(await freeAt('17:00')).toBe(3);
    });

    it('rejects a student cancelling less than 2h before the start', async () => {
      const soon = await makeBooking(ctx, { studentId: student.user.id, start: new Date(Date.now() + HOUR) });
      await cancel(student.token, soon.id).expect(403);
      expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: soon.id } })).status).toBe('CONFIRMED');
    });

    it('allows a student to cancel just outside the 2h window', async () => {
      const later = await makeBooking(ctx, {
        studentId: student.user.id, start: new Date(Date.now() + 2 * HOUR + 5 * 60_000),
      });
      await cancel(student.token, later.id).expect(200);
    });

    it("rejects cancelling someone else's booking", async () => {
      const other = await createUserWithToken(ctx);
      const created = await book(other.token, bookingBody(day, '17:00')).expect(201);
      await cancel(student.token, created.body.id).expect(403);
    });

    it('lets the professor cancel any booking at any time', async () => {
      const prof = await createUserWithToken(ctx, { role: 'PROFESSOR' });
      const soon = await makeBooking(ctx, { studentId: student.user.id, start: new Date(Date.now() + HOUR / 2) });
      const res = await cancel(prof.token, soon.id).expect(200);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('returns 404 for an unknown booking', async () => {
      await cancel(student.token, 999_999).expect(404);
    });

    it('is idempotent for an already cancelled booking', async () => {
      const created = await book(student.token, bookingBody(day, '17:00')).expect(201);
      await cancel(student.token, created.body.id).expect(200);
      await cancel(student.token, created.body.id).expect(200);
    });

    it('rejects a non-numeric id', async () => {
      await http(ctx).delete('/bookings/abc').set(auth(student.token)).expect(400);
    });
  });
});
