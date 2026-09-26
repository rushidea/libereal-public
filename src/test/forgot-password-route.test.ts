import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

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
import { sendPasswordResetEmail } from '@/lib/mail';
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
});
