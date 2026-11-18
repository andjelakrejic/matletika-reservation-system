import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PASSWORD, TestCtx, auth, createTestApp, createUserWithToken, http, isOk, login, makeBooking, resetDb,
} from './helpers.js';

const DAY = 24 * 3_600_000;

describe('Users / profile', () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  describe('PATCH /me/updateProfile', () => {
    it('updates and trims first and last name', async () => {
      const { token } = await createUserWithToken(ctx);
      const res = await http(ctx).patch('/me/updateProfile').set(auth(token)).send({ firstName: '  Mara ', lastName: 'Maric' }).expect(200);
      expect(res.body).toMatchObject({ firstName: 'Mara', lastName: 'Maric' });
    });

    it('does not allow changing the email or the role', async () => {
      const { user, token } = await createUserWithToken(ctx, { email: 'ana@test.com' });
      await http(ctx).patch('/me/updateProfile').set(auth(token)).send({ firstName: 'Ana', email: 'hacker@test.com', role: 'PROFESSOR' });
      const after = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.email).toBe('ana@test.com');
      expect(after.role).toBe('STUDENT');
    });

    it('rejects invalid names and missing token', async () => {
      const { token } = await createUserWithToken(ctx);
      await http(ctx).patch('/me/updateProfile').set(auth(token)).send({ firstName: 'A' }).expect(400);
      await http(ctx).patch('/me/updateProfile').send({ firstName: 'Mara' }).expect(401);
    });
  });

  describe('PATCH /me/changePassword', () => {
    const change = (token: string, body: Record<string, string>) =>
      http(ctx).patch('/me/changePassword').set(auth(token)).send(body);

    it('changes the password', async () => {
      const { user, token } = await createUserWithToken(ctx);
      const res = await change(token, {
        currentPassword: PASSWORD, newPassword: 'NewPassword456!', confirmPassword: 'NewPassword456!',
      });
      expect(isOk(res.status)).toBe(true);
      expect(await login(ctx, user.email, 'NewPassword456!')).toBeTypeOf('string');
      await http(ctx).post('/auth/login').send({ email: user.email, password: PASSWORD }).expect(401);
    });

    it('rejects a wrong current password', async () => {
      const { token } = await createUserWithToken(ctx);
      await change(token, { currentPassword: 'wrong', newPassword: 'NewPassword456!', confirmPassword: 'NewPassword456!' }).expect(400);
    });

    it('rejects a confirmation that does not match', async () => {
      const { token } = await createUserWithToken(ctx);
      await change(token, { currentPassword: PASSWORD, newPassword: 'NewPassword456!', confirmPassword: 'Different456!' }).expect(400);
    });

    it('rejects a new password that is too short or equal to the old one', async () => {
      const { token } = await createUserWithToken(ctx);
      await change(token, { currentPassword: PASSWORD, newPassword: 'short', confirmPassword: 'short' }).expect(400);
      await change(token, { currentPassword: PASSWORD, newPassword: PASSWORD, confirmPassword: PASSWORD }).expect(400);
    });

    it('needs a token', async () => {
      await http(ctx).patch('/me/changePassword').send({}).expect(401);
    });
  });

  describe('GET /me/getBookings', () => {
    it('splits upcoming and past, and only returns my own', async () => {
      const { user, token } = await createUserWithToken(ctx);
      const other = await createUserWithToken(ctx);

      const upcoming = await makeBooking(ctx, { studentId: user.id, start: new Date(Date.now() + 3 * DAY) });
      const past = await makeBooking(ctx, { studentId: user.id, start: new Date(Date.now() - 3 * DAY) });
      const cancelled = await makeBooking(ctx, {
        studentId: user.id, start: new Date(Date.now() + 4 * DAY), status: 'CANCELLED',
      });
      await makeBooking(ctx, { studentId: other.user.id, start: new Date(Date.now() + 3 * DAY) });

      const ids = async (when?: string) => {
        const res = await http(ctx).get(`/me/getBookings${when ? `?when=${when}` : ''}`).set(auth(token)).expect(200);
        return res.body.map((b: { id: number }) => b.id).sort();
      };

      expect(await ids('upcoming')).toEqual([upcoming.id]);
      expect(await ids('past')).toEqual([past.id, cancelled.id].sort());
      expect(await ids('all')).toEqual([upcoming.id, past.id, cancelled.id].sort());
      expect(await ids()).toHaveLength(3);
    });

    it('needs a token', async () => {
      await http(ctx).get('/me/getBookings').expect(401);
    });
  });

  describe('push token', () => {
    it('stores a valid Expo token and clears it again', async () => {
      const { user, token } = await createUserWithToken(ctx);
      const res = await http(ctx).post('/me/push-token').set(auth(token)).send({ token: 'ExponentPushToken[abc123]' });
      expect(isOk(res.status)).toBe(true);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).pushToken).toBe('ExponentPushToken[abc123]');

      await http(ctx).delete('/me/push-token').set(auth(token)).expect(200);
      expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })).pushToken).toBeNull();
    });

    it('rejects a token that is not an Expo push token', async () => {
      const { token } = await createUserWithToken(ctx);
      await http(ctx).post('/me/push-token').set(auth(token)).send({ token: 'abc' }).expect(400);
    });
  });

  describe('DELETE /me', () => {
    it('rejects a wrong password and keeps the account', async () => {
      const { user, token } = await createUserWithToken(ctx);
      await http(ctx).delete('/me').set(auth(token)).send({ password: 'wrong' }).expect(400);
      expect(await ctx.prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
    });

    it('deletes the account, cancels future bookings and keeps past ones anonymously', async () => {
      const { user, token } = await createUserWithToken(ctx);
      const future = await makeBooking(ctx, { studentId: user.id, start: new Date(Date.now() + 3 * DAY) });
      const past = await makeBooking(ctx, { studentId: user.id, start: new Date(Date.now() - 3 * DAY) });

      await http(ctx).delete('/me').set(auth(token)).send({ password: PASSWORD }).expect(200);

      expect(await ctx.prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
      expect((await ctx.prisma.booking.findUniqueOrThrow({ where: { id: future.id } })).status).toBe('CANCELLED');
      const keptPast = await ctx.prisma.booking.findUniqueOrThrow({ where: { id: past.id } });
      expect(keptPast.status).toBe('CONFIRMED');
      expect(keptPast.studentId).toBeNull();

      await http(ctx).post('/auth/login').send({ email: user.email, password: PASSWORD }).expect(401);
    });

    it('does not let the professor account be deleted this way', async () => {
      const { token } = await createUserWithToken(ctx, { role: 'PROFESSOR' });
      await http(ctx).delete('/me').set(auth(token)).send({ password: PASSWORD }).expect(403);
    });

    it('needs a token', async () => {
      await http(ctx).delete('/me').send({ password: PASSWORD }).expect(401);
    });
  });
});
