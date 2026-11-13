import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TIMEZONE } from '../src/config.js';
import {
  TestCtx, auth, createTestApp, createUserWithToken, futureDay, http, makeBooking, resetDb, setWorkingHours,
} from './helpers.js';

type SlotRes = { hour: string; startAt: string; free: number; capacity: number; maxHours: number };

describe('GET /slots', () => {
  let ctx: TestCtx;
  let token: string;
  const day = futureDay(1); // a Monday at least a week ahead

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    token = (await createUserWithToken(ctx)).token;
  });

  const getSlots = async (date = day.date): Promise<SlotRes[]> =>
    (await http(ctx).get(`/slots?date=${date}`).set(auth(token)).expect(200)).body;
  const byHour = (slots: SlotRes[]) => Object.fromEntries(slots.map((s) => [s.hour, s]));

  it('needs a token and a valid date', async () => {
    await http(ctx).get(`/slots?date=${day.date}`).expect(401);
    await http(ctx).get('/slots?date=garbage').set(auth(token)).expect(400);
    await http(ctx).get('/slots').set(auth(token)).expect(400);
  });

  it('returns nothing on a day without working hours', async () => {
    await setWorkingHours(ctx, day);
    expect(await getSlots(futureDay(2).date)).toEqual([]); // Tuesday
  });

  it('returns half-hour blocks inside the working hours', async () => {
    await setWorkingHours(ctx, day, '16:00', '20:00');
    const slots = await getSlots();
    expect(slots.map((s) => s.hour)).toEqual([
      '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30',
    ]);
    expect(slots.every((s) => s.free === 3 && s.capacity === 3)).toBe(true);
  });

  it('returns startAt as UTC ISO strings in time order', async () => {
    await setWorkingHours(ctx, day);
    const slots = await getSlots();
    expect(slots[0].startAt).toBe(day.iso('16:00'));
    expect([...slots].sort((a, b) => a.startAt.localeCompare(b.startAt))).toEqual(slots);
  });

  it('maxHours tells how long a booking can run from each start', async () => {
    await setWorkingHours(ctx, day, '16:00', '20:00');
    const s = byHour(await getSlots());
    expect(s['16:00'].maxHours).toBe(2);
    expect(s['18:00'].maxHours).toBe(2); // 18:00-20:00 fits exactly
    expect(s['18:30'].maxHours).toBe(1); // 2h would run past 20:00
    expect(s['19:00'].maxHours).toBe(1);
    expect(s['19:30'].maxHours).toBe(0); // 1h would run past 20:00
  });

  it('supports several working periods on the same day', async () => {
    await setWorkingHours(ctx, day, '09:00', '10:00');
    await setWorkingHours(ctx, day, '16:00', '17:00');
    expect((await getSlots()).map((s) => s.hour)).toEqual(['09:00', '09:30', '16:00', '16:30']);
  });

  it('subtracts active bookings from the free seats of the blocks they cover', async () => {
    await setWorkingHours(ctx, day);
    await makeBooking(ctx, { start: day.at('17:00').toJSDate(), hours: 1, status: 'PENDING' });
    await makeBooking(ctx, { start: day.at('17:00').toJSDate(), hours: 1, status: 'CONFIRMED' });
    const s = byHour(await getSlots());
    expect(s['17:00'].free).toBe(1);
    expect(s['17:30'].free).toBe(1);
    expect(s['16:30'].free).toBe(3);
    expect(s['18:00'].free).toBe(3);
  });

  it('counts a booking that starts at half past in two neighbouring hours', async () => {
    await setWorkingHours(ctx, day);
    await makeBooking(ctx, { start: day.at('17:30').toJSDate(), hours: 1 }); // 17:30-18:30
    const s = byHour(await getSlots());
    expect(s['17:00'].free).toBe(3);
    expect(s['17:30'].free).toBe(2);
    expect(s['18:00'].free).toBe(2);
    expect(s['18:30'].free).toBe(3);
  });

  it('ignores cancelled bookings', async () => {
    await setWorkingHours(ctx, day);
    await makeBooking(ctx, { start: day.at('17:00').toJSDate(), status: 'CANCELLED' });
    expect(byHour(await getSlots())['17:00'].free).toBe(3);
  });

  it('a full block cannot start a booking and shortens its neighbours', async () => {
    await setWorkingHours(ctx, day);
    for (let i = 0; i < 3; i++) await makeBooking(ctx, { start: day.at('17:00').toJSDate(), hours: 1 });
    const s = byHour(await getSlots());
    expect(s['17:00'].free).toBe(0);
    expect(s['17:00'].maxHours).toBe(0);
    expect(s['16:00'].maxHours).toBe(1); // 16:00-17:00 is fine, 2h would hit the full block
    expect(s['16:30'].maxHours).toBe(0);
    expect(s['18:00'].maxHours).toBe(2);
  });

  it('removes blocks that fall inside a day off', async () => {
    await setWorkingHours(ctx, day);
    await ctx.prisma.timeOff.create({
      data: { startAt: day.at('17:00').toJSDate(), endAt: day.at('18:00').toJSDate() },
    });
    const s = byHour(await getSlots());
    expect(s['17:00']).toBeUndefined();
    expect(s['17:30']).toBeUndefined();
    expect(s['16:30'].maxHours).toBe(0);
    expect(s['18:00']).toBeDefined();
  });

  it('returns nothing for a day fully covered by a day off', async () => {
    await setWorkingHours(ctx, day);
    await ctx.prisma.timeOff.create({
      data: { startAt: day.at('00:00').toJSDate(), endAt: day.at('23:59').toJSDate() },
    });
    expect(await getSlots()).toEqual([]);
  });

  it('does not offer blocks in the past', async () => {
    const past = DateTime.now().setZone(TIMEZONE).minus({ days: 3 });
    await ctx.prisma.availability.create({
      data: { weekday: past.weekday % 7, startTime: '16:00', endTime: '20:00' },
    });
    expect(await getSlots(past.toFormat('yyyy-MM-dd'))).toEqual([]);
  });
});
