import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemindersService } from '../src/notifications/reminders.service.js';
import {
  TestCtx, auth, bookingBody, createTestApp, createUserWithToken, futureDay, http, makeBooking, resetDb,
  setWorkingHours,
} from './helpers.js';

const MINUTE = 60_000;
const TOKEN = 'ExponentPushToken[student-device]';

const okTicket = () => new Response(JSON.stringify({ data: [{ status: 'ok', id: 'abc' }] }), { status: 200 });
const notRegisteredTicket = () =>
  new Response(
    JSON.stringify({
      data: [{ status: 'error', message: 'Device not registered', details: { error: 'DeviceNotRegistered' } }],
    }),
    { status: 200 },
  );

describe('Push notifications and reminders', () => {
  let ctx: TestCtx;
  const fetchMock = vi.fn<(...args: any[]) => Promise<Response>>();

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => okTicket());
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sentTo = () => fetchMock.mock.calls.map((c) => JSON.parse(c[1].body as string)[0].to);
  const reminders = () => ctx.app.get(RemindersService);

  describe('reminder job', () => {
    it('reminds a student whose confirmed booking starts within the hour, once', async () => {
      const { user } = await createUserWithToken(ctx, { pushToken: TOKEN });
      const booking = await makeBooking(ctx, { studentId: user.id, start: new Date(Date.now() + 30 * MINUTE) });

      await reminders().sendReminders();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain('exp.host');
      expect(sentTo()).toEqual([TOKEN]);
      expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).reminderSentAt).not.toBeNull();

      await reminders().sendReminders(); // second run must not send it again
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not remind for bookings that are too far away, pending, cancelled or past', async () => {
      const { user } = await createUserWithToken(ctx, { pushToken: TOKEN });
      await makeBooking(ctx, { studentId: user.id, start: new Date(Date.now() + 3 * 60 * MINUTE) });
      await makeBooking(ctx, { studentId: user.id, start: new Date(Date.now() + 30 * MINUTE), status: 'PENDING' });
      await makeBooking(ctx, { studentId: user.id, start: new Date(Date.now() + 40 * MINUTE), status: 'CANCELLED' });
      await makeBooking(ctx, { studentId: user.id, start: new Date(Date.now() - 30 * MINUTE) });

      await reminders().sendReminders();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('skips guests and marks bookings of students without a push token as handled', async () => {
      const { user } = await createUserWithToken(ctx); // no push token
      const a = await makeBooking(ctx, { studentId: user.id, start: new Date(Date.now() + 30 * MINUTE) });
      await makeBooking(ctx, { guestName: 'Marko', start: new Date(Date.now() + 30 * MINUTE) });

      await reminders().sendReminders();
      expect(fetchMock).not.toHaveBeenCalled();
      expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: a.id } })).reminderSentAt).not.toBeNull();
    });

    it('keeps working when the push service fails', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      const { user } = await createUserWithToken(ctx, { pushToken: TOKEN });
      await makeBooking(ctx, { studentId: user.id, start: new Date(Date.now() + 30 * MINUTE) });
      await expect(reminders().sendReminders()).resolves.not.toThrow();
    });
  });

  describe('booking status changes', () => {
    const day = futureDay(1);
    let prof: Awaited<ReturnType<typeof createUserWithToken>>;
    let student: Awaited<ReturnType<typeof createUserWithToken>>;

    beforeEach(async () => {
      await setWorkingHours(ctx, day);
      prof = await createUserWithToken(ctx, { role: 'PROFESSOR' });
      student = await createUserWithToken(ctx, { pushToken: TOKEN });
      fetchMock.mockClear();
    });

    const studentBooks = async () =>
      (await http(ctx).post('/bookings').set(auth(student.token)).send(bookingBody(day, '17:00')).expect(201)).body;

    it('notifies the student when the professor confirms', async () => {
      const b = await studentBooks();
      await http(ctx).patch(`/admin/setBookingStatus/${b.id}`).set(auth(prof.token)).send({ status: 'CONFIRMED' }).expect(200);
      expect(sentTo()).toEqual([TOKEN]);
    });

    it('notifies the student when the professor rejects', async () => {
      const b = await studentBooks();
      await http(ctx).patch(`/admin/setBookingStatus/${b.id}`).set(auth(prof.token)).send({ status: 'CANCELLED' }).expect(200);
      expect(sentTo()).toEqual([TOKEN]);
    });

    it('notifies the student when the professor cancels the booking', async () => {
      const b = await studentBooks();
      await http(ctx).delete(`/bookings/${b.id}`).set(auth(prof.token)).expect(200);
      expect(sentTo()).toEqual([TOKEN]);
    });

    it('does not notify when the student cancels their own booking', async () => {
      const b = await studentBooks();
      await http(ctx).delete(`/bookings/${b.id}`).set(auth(student.token)).expect(200);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not notify for guest bookings or students without a token', async () => {
      const noToken = await createUserWithToken(ctx);
      const b = await makeBooking(ctx, { studentId: noToken.user.id, start: day.at('18:00').toJSDate(), status: 'PENDING' });
      await http(ctx).patch(`/admin/setBookingStatus/${b.id}`).set(auth(prof.token)).send({ status: 'CONFIRMED' }).expect(200);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not fail the request when sending the push fails', async () => {
      fetchMock.mockRejectedValue(new Error('network down'));
      const b = await studentBooks();
      await http(ctx).patch(`/admin/setBookingStatus/${b.id}`).set(auth(prof.token)).send({ status: 'CONFIRMED' }).expect(200);
    });

    it('forgets a push token that the device no longer accepts', async () => {
      fetchMock.mockImplementation(async () => notRegisteredTicket());
      const b = await studentBooks();
      await http(ctx).patch(`/admin/setBookingStatus/${b.id}`).set(auth(prof.token)).send({ status: 'CONFIRMED' }).expect(200);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: student.user.id } })).pushToken).toBeNull();
    });
  });
});
