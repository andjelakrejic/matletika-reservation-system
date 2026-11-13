import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PASSWORD, TestCtx, auth, createTestApp, createUser, createUserWithToken, http, isOk, login, resetDb,
} from './helpers.js';

describe('Auth', () => {
  let ctx: TestCtx;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mails.length = 0;
  });

  // If your RegisterDto has extra required fields, add them here
  const registerBody = {
    firstName: 'Ana',
    lastName: 'Anic',
    email: 'ana@test.com',
    password: PASSWORD,
    confirmPassword: PASSWORD,
  };

  describe('register', () => {
    it('creates a student and returns a token', async () => {
      const res = await http(ctx).post('/auth/register').send(registerBody).expect(201);
      expect(res.body.token).toBeTypeOf('string');
      expect(res.body.user).toMatchObject({ email: 'ana@test.com', role: 'STUDENT' });
      expect(res.body.user.password).toBeUndefined();
    });

    it('never lets a user choose their own role', async () => {
      const res = await http(ctx).post('/auth/register').send({ ...registerBody, role: 'PROFESSOR' });
      expect(isOk(res.status)).toBe(true);
      expect(res.body.user.role).toBe('STUDENT');
    });

    it('stores a hashed password', async () => {
      await http(ctx).post('/auth/register').send(registerBody).expect(201);
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'ana@test.com' } });
      expect(user.password).not.toBe(PASSWORD);
    });

    it('rejects a duplicate email, ignoring case', async () => {
      await http(ctx).post('/auth/register').send(registerBody).expect(201);
      await http(ctx).post('/auth/register').send({ ...registerBody, email: 'ANA@test.com' }).expect(409);
    });

    it('rejects invalid input', async () => {
      await http(ctx).post('/auth/register').send({ ...registerBody, email: 'not-an-email' }).expect(400);
      await http(ctx).post('/auth/register').send({ ...registerBody, password: 'short', confirmPassword: 'short' }).expect(400);
      await http(ctx).post('/auth/register').send({ email: 'x@test.com' }).expect(400);
    });
  });

  describe('login', () => {
    it('returns a token for valid credentials', async () => {
      await createUser(ctx, { email: 'ana@test.com' });
      const res = await http(ctx).post('/auth/login').send({ email: 'ana@test.com', password: PASSWORD });
      expect(isOk(res.status)).toBe(true);
      expect(res.body.token).toBeTypeOf('string');
    });

    it('is case-insensitive for the email', async () => {
      await createUser(ctx, { email: 'ana@test.com' });
      const res = await http(ctx).post('/auth/login').send({ email: 'ANA@test.com', password: PASSWORD });
      expect(isOk(res.status)).toBe(true);
    });

    it('rejects a wrong password and an unknown email with 401', async () => {
      await createUser(ctx, { email: 'ana@test.com' });
      await http(ctx).post('/auth/login').send({ email: 'ana@test.com', password: 'wrong-password' }).expect(401);
      await http(ctx).post('/auth/login').send({ email: 'nobody@test.com', password: PASSWORD }).expect(401);
    });
  });

  describe('protected routes', () => {
    it('GET /me needs a valid token', async () => {
      await http(ctx).get('/me').expect(401);
      await http(ctx).get('/me').set(auth('garbage.token.value')).expect(401);
    });

    it('GET /me returns the profile without the password', async () => {
      const { token } = await createUserWithToken(ctx, { email: 'ana@test.com', firstName: 'Ana' });
      const res = await http(ctx).get('/me').set(auth(token)).expect(200);
      expect(res.body).toMatchObject({ email: 'ana@test.com', firstName: 'Ana', role: 'STUDENT' });
      expect(res.body.password).toBeUndefined();
    });
  });

  describe('forgot / reset password', () => {
    const codeFromMail = () => /\b(\d{6})\b/.exec(ctx.mails.at(-1)?.text ?? '')?.[1];
    const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

    async function requestCode(email = 'ana@test.com') {
      const res = await http(ctx).post('/auth/forgot-password').send({ email });
      expect(isOk(res.status)).toBe(true);
      return codeFromMail();
    }

    const reset = (code: string, newPassword = 'NewPassword456!') =>
      http(ctx).post('/auth/reset-password').send({
        email: 'ana@test.com', code, newPassword, confirmPassword: newPassword,
      });

    it('answers the same way for unknown emails and sends no mail', async () => {
      const res = await http(ctx).post('/auth/forgot-password').send({ email: 'nobody@test.com' });
      expect(isOk(res.status)).toBe(true);
      expect(res.body).toEqual({ ok: true });
      expect(ctx.mails).toHaveLength(0);
    });

    it('mails a 6-digit code to a known user', async () => {
      await createUser(ctx, { email: 'ana@test.com' });
      const code = await requestCode();
      expect(code).toMatch(/^\d{6}$/);
      expect(ctx.mails[0].to).toBe('ana@test.com');
    });

    it('does not store the code in plain text', async () => {
      await createUser(ctx, { email: 'ana@test.com' });
      const code = await requestCode();
      const row = await ctx.prisma.passwordReset.findFirstOrThrow();
      expect(row.codeHash).not.toBe(code);
      expect(row.codeHash.length).toBeGreaterThan(6);
    });

    it('sends at most one code per minute', async () => {
      await createUser(ctx, { email: 'ana@test.com' });
      await requestCode();
      await requestCode();
      expect(ctx.mails).toHaveLength(1);
    });

    it('changes the password with the right code', async () => {
      await createUser(ctx, { email: 'ana@test.com' });
      const code = (await requestCode())!;
      const res = await reset(code);
      expect(isOk(res.status)).toBe(true);

      expect(await login(ctx, 'ana@test.com', 'NewPassword456!')).toBeTypeOf('string');
      await http(ctx).post('/auth/login').send({ email: 'ana@test.com', password: PASSWORD }).expect(401);
    });

    it('accepts a code only once', async () => {
      await createUser(ctx, { email: 'ana@test.com' });
      const code = (await requestCode())!;
      expect(isOk((await reset(code)).status)).toBe(true);
      await reset(code, 'AnotherPassword789!').expect(400);
    });

    it('rejects a wrong code and a mismatching confirmation', async () => {
      await createUser(ctx, { email: 'ana@test.com' });
      const code = (await requestCode())!;
      await reset(wrongCode(code)).expect(400);
      await http(ctx).post('/auth/reset-password').send({
        email: 'ana@test.com', code, newPassword: 'NewPassword456!', confirmPassword: 'Different456!',
      }).expect(400);
    });

    it('locks the code after 5 wrong attempts', async () => {
      await createUser(ctx, { email: 'ana@test.com' });
      const code = (await requestCode())!;
      for (let i = 0; i < 5; i++) await reset(wrongCode(code)).expect(400);
      await reset(code).expect(400); // even the correct code no longer works
    });

    it('rejects an expired code', async () => {
      await createUser(ctx, { email: 'ana@test.com' });
      const code = (await requestCode())!;
      await ctx.prisma.passwordReset.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await reset(code).expect(400);
    });

    it('rejects a reset for an unknown email', async () => {
      await http(ctx).post('/auth/reset-password').send({
        email: 'nobody@test.com', code: '123456', newPassword: 'NewPassword456!', confirmPassword: 'NewPassword456!',
      }).expect(400);
    });
  });

  it('protected routes accept a token from login', async () => {
    const { token } = await createUserWithToken(ctx);
    await http(ctx).get('/me').set(auth(token)).expect(200);
  });
});
