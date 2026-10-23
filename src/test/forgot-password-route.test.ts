import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import bcrypt from 'bcryptjs';

vi.mock('@/lib/mail', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mail')>('@/lib/mail');
  return {
    ...actual,
    sendPasswordResetEmail: vi.fn().mockResolvedValue({ ok: true, provider: 'console' }),
  };
});

vi.mock('@/lib/sms-verification', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sms-verification')>('@/lib/sms-verification');
  return {
    ...actual,
    verifySmsCode: vi.fn(async () => true),
  };
});

import { POST as forgotPasswordPOST } from '@/app/api/auth/forgot-password/route';
import { POST as resetPasswordPOST } from '@/app/api/auth/reset-password/route';
import { sendPasswordResetEmail } from '@/lib/mail';
import { getEphemeralStore } from '@/lib/ephemeral-store';
import { verifySmsCode } from '@/lib/sms-verification';
import { NextRequest } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

const sendPasswordResetEmailMock = sendPasswordResetEmail as unknown as Mock;
const verifySmsCodeMock = verifySmsCode as unknown as Mock;

function makeReq(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function emailRequest(email: string, ip = '198.51.100.10'): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify({ method: 'email', email }),
  });
}

async function expireEmailCooldown(email: string) {
  const hash = createHash('sha256').update(email).digest('hex');
  getTestDb().prepare("UPDATE TransientEntry SET expiresAt = datetime('now', '-1 second') WHERE key = ?")
    .run(`password-reset:cooldown:${hash}`);
}

describe('POST /api/auth/forgot-password', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    sendPasswordResetEmailMock.mockClear();
    verifySmsCodeMock.mockClear();
  });

  it('stores a reset token and sends an email link without requiring a phone code', async () => {
    const db = getTestDb();
    seedUser(db, {
      id: 'u1',
      email: 'user@test.com',
      phone: '13800000000',
      phoneVerifiedAt: new Date().toISOString(),
    });

    const res = await forgotPasswordPOST(makeReq({
      method: 'email',
      email: 'USER@test.com ',
    }) as NextRequest);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/重置链接/);
    expect(json.resetUrl).toBeUndefined();

    const user = db.prepare('SELECT resetToken, resetTokenExpiry FROM User WHERE id = ?').get('u1') as {
      resetToken: string | null;
      resetTokenExpiry: string | null;
    };
    expect(user.resetToken).toHaveLength(64);
    expect(user.resetTokenExpiry).toBeTruthy();
    expect(sendPasswordResetEmailMock).toHaveBeenCalledWith('user@test.com', user.resetToken);
    expect(verifySmsCodeMock).not.toHaveBeenCalled();
  });

  it('returns the same generic response for unknown email', async () => {
    const res = await forgotPasswordPOST(makeReq({
      method: 'email',
      email: 'missing@test.com',
    }) as NextRequest);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.resetUrl).toBeUndefined();
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });

  it('issues a short-lived reset token after verifying an already verified phone', async () => {
    const db = getTestDb();
    seedUser(db, {
      id: 'u1',
      email: 'user@test.com',
      phone: '13800000000',
      phoneVerifiedAt: new Date().toISOString(),
    });

    const res = await forgotPasswordPOST(makeReq({
      method: 'phone',
      phone: '13800000000',
      smsCode: '123456',
    }) as NextRequest);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.resetToken).toHaveLength(64);
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
    expect(verifySmsCodeMock).toHaveBeenCalledWith('13800000000', '123456', 'reset-password');

    const user = db.prepare('SELECT resetToken FROM User WHERE id = ?').get('u1') as { resetToken: string | null };
    expect(user.resetToken).toBe(json.resetToken);
  });

  it('rejects phone recovery when the phone is not verified by an account', async () => {
    const res = await forgotPasswordPOST(makeReq({
      method: 'phone',
      phone: '13800000000',
      smsCode: '123456',
    }) as NextRequest);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/验证码错误或已过期/);
    expect(verifySmsCodeMock).not.toHaveBeenCalled();
  });

  it('normalizes email and lets only one concurrent request claim its cooldown', async () => {
    seedUser(getTestDb(), { id: 'u1', email: 'user@test.com' });
    const results = await Promise.all([
      forgotPasswordPOST(emailRequest(' USER@test.com ')),
      forgotPasswordPOST(emailRequest('user@TEST.com')),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a valid token and its original expiry when a cooldown permits a later resend', async () => {
    seedUser(getTestDb(), { id: 'u1', email: 'user@test.com' });
    await forgotPasswordPOST(emailRequest('user@test.com'));
    const first = getTestDb().prepare('SELECT resetToken, resetTokenExpiry FROM User WHERE id = ?').get('u1') as {
      resetToken: string; resetTokenExpiry: string;
    };
    const duringCooldown = await forgotPasswordPOST(emailRequest('user@test.com', '198.51.100.12'));
    expect(duringCooldown.status).toBe(200);
    expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(1);
    await expireEmailCooldown('user@test.com');
    await forgotPasswordPOST(emailRequest('user@test.com', '198.51.100.11'));
    const second = getTestDb().prepare('SELECT resetToken, resetTokenExpiry FROM User WHERE id = ?').get('u1') as {
      resetToken: string; resetTokenExpiry: string;
    };
    expect(second).toEqual(first);
    expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(2);
    expect(sendPasswordResetEmailMock.mock.calls[1]).toEqual(['user@test.com', first.resetToken]);
  });

  it('enforces the daily address quota across source IPs and charges failed mail sends', async () => {
    seedUser(getTestDb(), { id: 'u1', email: 'user@test.com' });
    for (let i = 0; i < 5; i += 1) {
      sendPasswordResetEmailMock.mockResolvedValueOnce({ ok: false, provider: 'test' });
      const response = await forgotPasswordPOST(emailRequest('user@test.com', `198.51.100.${i + 1}`));
      expect(response.status).toBe(200);
      await expireEmailCooldown('user@test.com');
    }
    const response = await forgotPasswordPOST(emailRequest('user@test.com', '203.0.113.9'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: '如果该邮箱已注册，重置链接已发送至您的邮箱' });
    expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(5);
  });

  it('applies the source quota across distinct addresses and returns the generic response', async () => {
    for (let i = 0; i < 20; i += 1) {
      const response = await forgotPasswordPOST(emailRequest(`unknown${i}@test.com`, '192.0.2.80'));
      expect(response.status).toBe(200);
    }
    seedUser(getTestDb(), { id: 'u1', email: 'registered@test.com' });
    const final = await forgotPasswordPOST(emailRequest('registered@test.com', '192.0.2.80'));
    expect(final.status).toBe(200);
    expect(await final.json()).toEqual({ message: '如果该邮箱已注册，重置链接已发送至您的邮箱' });
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
    const alternateSource = await forgotPasswordPOST(emailRequest('registered@test.com', '192.0.2.81'));
    expect(alternateSource.status).toBe(200);
    expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(1);
  });

  it('retains cooldown after a rejected mail promise and remains generic', async () => {
    seedUser(getTestDb(), { id: 'u1', email: 'user@test.com' });
    sendPasswordResetEmailMock.mockRejectedValueOnce(new Error('mail down'));
    const first = await forgotPasswordPOST(emailRequest('user@test.com'));
    const second = await forgotPasswordPOST(emailRequest('user@test.com'));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ message: '如果该邮箱已注册，重置链接已发送至您的邮箱' });
    expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(1);
  });

  it('recovers through a successful resend after mail failure and issues fresh tokens after use', async () => {
    seedUser(getTestDb(), { id: 'u1', email: 'user@test.com' });
    sendPasswordResetEmailMock.mockRejectedValueOnce(new Error('mail down'));
    await forgotPasswordPOST(emailRequest('user@test.com'));
    const initial = getTestDb().prepare('SELECT resetToken FROM User WHERE id = ?').get('u1') as { resetToken: string };

    await expireEmailCooldown('user@test.com');
    await forgotPasswordPOST(emailRequest('user@test.com'));
    expect(sendPasswordResetEmailMock).toHaveBeenLastCalledWith('user@test.com', initial.resetToken);

    const reset = await resetPasswordPOST(new NextRequest('http://localhost:3000/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: initial.resetToken, password: 'recovered-pass-123' }),
    }));
    expect(reset.status).toBe(200);
    const changed = getTestDb().prepare('SELECT password, resetToken FROM User WHERE id = ?').get('u1') as {
      password: string; resetToken: string | null;
    };
    expect(changed.resetToken).toBeNull();
    expect(await bcrypt.compare('recovered-pass-123', changed.password)).toBe(true);

    await expireEmailCooldown('user@test.com');
    const resend = await forgotPasswordPOST(emailRequest('user@test.com', '203.0.113.24'));
    expect(resend.status).toBe(200);
    expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(3);
    const replacement = getTestDb().prepare('SELECT resetToken FROM User WHERE id = ?').get('u1') as { resetToken: string };
    expect(replacement.resetToken).toHaveLength(64);
    expect(replacement.resetToken).not.toBe(initial.resetToken);
  });

  it('allows the same address again after its daily quota expires', async () => {
    seedUser(getTestDb(), { id: 'u1', email: 'user@test.com' });
    for (let i = 0; i < 5; i += 1) {
      await forgotPasswordPOST(emailRequest('user@test.com', `198.51.100.${i + 1}`));
      await expireEmailCooldown('user@test.com');
    }
    const hash = createHash('sha256').update('user@test.com').digest('hex');
    getTestDb().prepare("UPDATE TransientEntry SET expiresAt = datetime('now', '-1 second') WHERE key = ?")
      .run(`password-reset:email:${hash}`);
    const recovered = await forgotPasswordPOST(emailRequest('user@test.com', '203.0.113.29'));
    expect(recovered.status).toBe(200);
    expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(6);
  });

  it('fails closed with the generic response when persistent rate-limit storage fails', async () => {
    seedUser(getTestDb(), { id: 'u1', email: 'user@test.com' });
    const store = getEphemeralStore();
    const increment = vi.spyOn(store, 'increment').mockRejectedValueOnce(new Error('store unavailable'));
    const response = await forgotPasswordPOST(emailRequest('user@test.com'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: '如果该邮箱已注册，重置链接已发送至您的邮箱' });
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
    increment.mockRestore();
  });

  it('shares limiter state with a fresh Node process using the same database', async () => {
    const helper = path.join(process.cwd(), 'src/test/helpers/password-reset-rate-limit-worker.ts');
    const runFreshProcess = () => execFileSync(process.execPath, ['--import', 'tsx', helper], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_PATH: process.env.DATABASE_PATH!, RESET_TEST_IP: '203.0.113.44', RESET_TEST_EMAIL: 'persist@test.com' },
      encoding: 'utf8',
      timeout: 20_000,
    }).trim();
    expect(runFreshProcess()).toBe('true');
    expect(runFreshProcess()).toBe('false');
  });
});
