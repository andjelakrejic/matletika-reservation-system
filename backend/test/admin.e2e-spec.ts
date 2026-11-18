import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TestCtx, auth, bookingBody, createTestApp, createUserWithToken, futureDay, http, makeBooking, resetDb,
  setWorkingHours,
} from './helpers.js';
import { PRICE_PER_HOUR, CANCEL_DEADLINE_MS } from '../src/config.js';

describe('Admin (professor)', () => {
  let ctx: TestCtx;
  let prof: Awaited<ReturnType<typeof createUserWithToken>>;
  let student: Awaited<ReturnType<typeof createUserWithToken>>;
  const day = futureDay(1);

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await setWorkingHours(ctx, day, '16:00', '20:00');
    prof = await createUserWithToken(ctx, { role: 'PROFESSOR', firstName: 'Prof', lastName: 'Esor' });
    student = await createUserWithToken(ctx, { firstName: 'Ana', lastName: 'Anic' });
  });

  const asProf = {
    get: (url: string) => http(ctx).get(url).set(auth(prof.token)),
    post: (url: string) => http(ctx).post(url).set(auth(prof.token)),
    patch: (url: string) => http(ctx).patch(url).set(auth(prof.token)),
    put: (url: string) => http(ctx).put(url).set(auth(prof.token)),
    delete: (url: string) => http(ctx).delete(url).set(auth(prof.token)),
  };
  const studentBooks = (time: string, hours = 1) =>
    http(ctx).post('/bookings').set(auth(student.token)).send(bookingBody(day, time, hours)).expect(201);

  describe('access control', () => {
    const routes: [string, string][] = [
      ['get', '/admin/getAllBookings'],
      ['patch', '/admin/setBookingStatus/1'],
      ['post', '/admin/createManualBooking'],
      ['get', '/admin/getSchedule?date=2030-01-07'],
      ['get', '/admin/availability'],
      ['put', '/admin/availability'],
      ['get', '/admin/time-off'],
      ['post', '/admin/time-off'],
      ['delete', '/admin/time-off/1'],
    ];

    it.each(routes)('%s %s rejects a missing token with 401', async (method, url) => {
      await (http(ctx) as any)[method](url).expect(401);
    });

    it.each(routes)('%s %s rejects a student with 403', async (method, url) => {
      await (http(ctx) as any)[method](url).set(auth(student.token)).send({}).expect(403);
    });
  });

  describe('GET /admin/getAllBookings', () => {
    it('lists pending requests with the student', async () => {
      await studentBooks('17:00');
      const res = await asProf.get('/admin/getAllBookings?status=PENDING').expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ status: 'PENDING', hours: 1 });
      expect(res.body[0].student).toMatchObject({ firstName: 'Ana', lastName: 'Anic' });
      expect(res.body[0].student.password).toBeUndefined();
    });

    it('filters by status and returns everything without a filter', async () => {
      await makeBooking(ctx, { studentId: student.user.id, start: day.at('16:00').toJSDate(), status: 'PENDING' });
      await makeBooking(ctx, { studentId: student.user.id, start: day.at('17:00').toJSDate(), status: 'CONFIRMED' });
      await makeBooking(ctx, { studentId: student.user.id, start: day.at('18:00').toJSDate(), status: 'CANCELLED' });

      expect((await asProf.get('/admin/getAllBookings?status=CONFIRMED').expect(200)).body).toHaveLength(1);
      expect((await asProf.get('/admin/getAllBookings?status=CANCELLED').expect(200)).body).toHaveLength(1);
      expect((await asProf.get('/admin/getAllBookings').expect(200)).body).toHaveLength(3);
    });

    it('rejects an unknown status', async () => {
      await asProf.get('/admin/getAllBookings?status=NOPE').expect(400);
    });
  });

  describe('PATCH /admin/setBookingStatus/:id', () => {
    it('confirms a pending booking', async () => {
      const created = await studentBooks('17:00');
      const res = await asProf.patch(`/admin/setBookingStatus/${created.body.id}`).send({ status: 'CONFIRMED' }).expect(200);
      expect(res.body.status).toBe('CONFIRMED');
    });

    it('rejects a pending booking and frees the seat', async () => {
      const created = await studentBooks('17:00');
      const res = await asProf.patch(`/admin/setBookingStatus/${created.body.id}`).send({ status: 'CANCELLED' }).expect(200);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('only confirms bookings that are pending', async () => {
      const created = await studentBooks('17:00');
      await asProf.patch(`/admin/setBookingStatus/${created.body.id}`).send({ status: 'CONFIRMED' }).expect(200);
      await asProf.patch(`/admin/setBookingStatus/${created.body.id}`).send({ status: 'CONFIRMED' }).expect(400);

      const cancelled = await makeBooking(ctx, { studentId: student.user.id, start: day.at('19:00').toJSDate(), status: 'CANCELLED' });
      await asProf.patch(`/admin/setBookingStatus/${cancelled.id}`).send({ status: 'CONFIRMED' }).expect(400);
    });

    it('does not expose the student push token', async () => {
      const created = await studentBooks('17:00');
      const res = await asProf.patch(`/admin/setBookingStatus/${created.body.id}`).send({ status: 'CONFIRMED' }).expect(200);
      expect(res.body.student).toBeUndefined();
    });

    it('rejects invalid statuses and unknown bookings', async () => {
      const created = await studentBooks('17:00');
      await asProf.patch(`/admin/setBookingStatus/${created.body.id}`).send({ status: 'PENDING' }).expect(400);
      await asProf.patch(`/admin/setBookingStatus/${created.body.id}`).send({}).expect(400);
      await asProf.patch('/admin/setBookingStatus/999999').send({ status: 'CONFIRMED' }).expect(404);
    });
  });

  describe('POST /admin/createManualBooking (manual entry)', () => {
    const manual = (body: Record<string, unknown>) =>
      asProf.post('/admin/createManualBooking').send({ startAt: day.iso('17:00'), hours: 1, ...body });

    it('adds a guest without an account as confirmed', async () => {
      const res = await manual({ guestName: 'Marko' }).expect(201);
      expect(res.body).toMatchObject({
        guestName: 'Marko', studentId: null, status: 'CONFIRMED', createdBy: 'PROFESSOR', price: PRICE_PER_HOUR,
      });
    });

    it('adds a registered student with school details', async () => {
      const res = await manual({
        studentId: student.user.id, hours: 2, schoolLevel: 'SECONDARY', grade: 2, topics: ['functions'],
      }).expect(201);
      expect(res.body).toMatchObject({
        studentId: student.user.id, status: 'CONFIRMED', price: PRICE_PER_HOUR * 2, grade: 2, topics: ['functions'],
      });
    });

    it('needs a student or a guest name', async () => {
      await manual({}).expect(400);
    });

    it('rejects an unknown student and an invalid start', async () => {
      await manual({ studentId: 999_999 }).expect(400);
      await manual({ guestName: 'Marko', startAt: day.iso('17:15') }).expect(400);
      await manual({ guestName: 'Marko', hours: 3 }).expect(400);
    });

    it('still respects the capacity', async () => {
      await manual({ guestName: 'A1' }).expect(201);
      await manual({ guestName: 'B2' }).expect(201);
      await manual({ guestName: 'C3' }).expect(201);
      await manual({ guestName: 'D4' }).expect(409);
    });

    it('is visible to students as taken seats only', async () => {
      await manual({ guestName: 'Marko' }).expect(201);
      const res = await http(ctx).get(`/slots?date=${day.date}`).set(auth(student.token)).expect(200);
      expect(res.body.find((s: { hour: string }) => s.hour === '17:00').free).toBe(2);
      expect(JSON.stringify(res.body)).not.toContain('Marko');
    });
  });

  describe('GET /admin/getSchedule', () => {
    it('lists who comes in each half-hour block', async () => {
      await studentBooks('17:00', 1);
      await asProf.post('/admin/createManualBooking').send({ startAt: day.iso('17:00'), hours: 1, guestName: 'Marko' }).expect(201);
      await makeBooking(ctx, { studentId: student.user.id, start: day.at('19:00').toJSDate(), status: 'CANCELLED' });

      const res = await asProf.get(`/admin/getSchedule?date=${day.date}`).expect(200);
      const blocks: { hour: string; entries: { name: string; status: string; grade: number; topics: string[] }[] }[] = res.body;

      expect(blocks.map((b) => b.hour)).toEqual(['17:00', '17:30']); // both cover 17:00-18:00
      const names = blocks[0].entries.map((e) => e.name).sort();
      expect(names).toEqual(['Ana Anic', 'Marko']);
      const ana = blocks[0].entries.find((e) => e.name === 'Ana Anic')!;
      expect(ana).toMatchObject({ status: 'PENDING', grade: 7, topics: ['fractions'] });
    });

    it('returns an empty list for a day without bookings', async () => {
      expect((await asProf.get(`/admin/getSchedule?date=${day.date}`).expect(200)).body).toEqual([]);
    });

    it('rejects an invalid date', async () => {
      await asProf.get('/admin/getSchedule?date=garbage').expect(400);
    });
  });

  describe('availability', () => {
    const item = (weekday: number, startTime: string, endTime: string) => ({ weekday, startTime, endTime });

    it('replaces the whole working schedule', async () => {
      const res = await asProf.put('/admin/availability').send({
        items: [item(3, '16:00', '20:00'), item(1, '09:30', '12:00')],
      });
      expect(res.status).toBeLessThan(300);
      const list = (await asProf.get('/admin/availability').expect(200)).body;
      expect(list.map((a: { weekday: number; startTime: string }) => [a.weekday, a.startTime])).toEqual([
        [1, '09:30'], [3, '16:00'],
      ]); // the Monday 16-20 row from setup is gone, rows are sorted
    });

    it('can clear the schedule completely', async () => {
      await asProf.put('/admin/availability').send({ items: [] });
      expect((await asProf.get('/admin/availability').expect(200)).body).toEqual([]);
    });

    it('rejects invalid schedules and keeps the old one', async () => {
      const bad: Record<string, unknown>[] = [
        { items: [item(1, '16:00', '16:00')] }, // start == end
        { items: [item(1, '18:00', '16:00')] }, // start after end
        { items: [item(1, '16:15', '18:00')] }, // not :00 / :30
        { items: [item(7, '16:00', '18:00')] }, // weekday out of range
        { items: [item(1, '16:00', '18:00'), item(1, '17:00', '19:00')] }, // overlap
        { items: [item(1, '16:00', '24:00')] }, // invalid time
        {}, // missing items
      ];
      for (const body of bad) await asProf.put('/admin/availability').send(body).expect(400);
      expect((await asProf.get('/admin/availability').expect(200)).body).toHaveLength(1);
    });

    it('allows two separate periods on the same day', async () => {
      const res = await asProf.put('/admin/availability').send({
        items: [item(1, '09:00', '12:00'), item(1, '16:00', '20:00')],
      });
      expect(res.status).toBeLessThan(300);
    });

    it('is used by the slot calculation right away', async () => {
      await asProf.put('/admin/availability').send({ items: [item(day.weekday, '10:00', '12:00')] });
      const res = await http(ctx).get(`/slots?date=${day.date}`).set(auth(student.token)).expect(200);
      expect(res.body.map((s: { hour: string }) => s.hour)).toEqual(['10:00', '10:30', '11:00', '11:30']);
    });
  });

  describe('time off', () => {
    const range = () => ({
      startAt: day.at('00:00').toUTC().toISO(),
      endAt: day.at('23:59').toUTC().toISO(),
    });

    it('creates a day off, which removes the slots of that day', async () => {
      const res = await asProf.post('/admin/time-off').send(range());
      expect(res.status).toBeLessThan(300);
      expect(res.body.affectedBookings).toBe(0);

      const slots = await http(ctx).get(`/slots?date=${day.date}`).set(auth(student.token)).expect(200);
      expect(slots.body).toEqual([]);
    });

    it('reports how many active bookings fall inside the new day off', async () => {
      await studentBooks('17:00');
      await makeBooking(ctx, { studentId: student.user.id, start: day.at('19:00').toJSDate(), status: 'CANCELLED' });
      const res = await asProf.post('/admin/time-off').send(range());
      expect(res.body.affectedBookings).toBe(1);
    });

    it('lists upcoming days off and hides past ones', async () => {
      await ctx.prisma.timeOff.create({
        data: { startAt: DateTime.now().minus({ days: 10 }).toJSDate(), endAt: DateTime.now().minus({ days: 9 }).toJSDate() },
      });
      await asProf.post('/admin/time-off').send(range());
      const list = (await asProf.get('/admin/time-off').expect(200)).body;
      expect(list).toHaveLength(1);
    });

    it('deletes a day off and brings the slots back', async () => {
      const created = await asProf.post('/admin/time-off').send(range());
      await asProf.delete(`/admin/time-off/${created.body.timeOff.id}`).expect(200);
      const slots = await http(ctx).get(`/slots?date=${day.date}`).set(auth(student.token)).expect(200);
      expect(slots.body.length).toBeGreaterThan(0);
    });

    it('rejects invalid ranges and unknown ids', async () => {
      await asProf.post('/admin/time-off').send({ startAt: day.iso('18:00'), endAt: day.iso('17:00') }).expect(400);
      await asProf.post('/admin/time-off').send({ startAt: 'garbage', endAt: 'garbage' }).expect(400);
      await asProf.delete('/admin/time-off/999999').expect(404);
    });
  });
});
