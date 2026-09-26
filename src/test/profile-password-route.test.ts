import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { getTestDb, closeTestDb, clearAllTables } from './db-helpers';

vi.mock('@/lib/session', () => ({
  requireActiveSession: vi.fn().mockResolvedValue({
    id: 'u1', email: 'user@test.com', name: 'User', role: 'customer', sessionId: 'session-1',
  }),
}));

vi.mock('@/lib/sms-verification', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sms-verification')>('@/lib/sms-verification');
  return {
    ...actual,
    verifySmsCode: vi.fn(async () => true),
  };
});

vi.mock('@/lib/security/security-step-up', () => ({
  consumeSecurityStepUpGrant: vi.fn(async () => true),
}));

import { PUT as passwordPUT } from '@/app/api/profile/password/route';

function makePutReq(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/profile/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/profile/password', () => {
  beforeAll(() => {
    getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  beforeEach(async () => {
    const db = getTestDb();
    clearAllTables(db);
    const hash = await bcrypt.hash('oldpass123', 12);
    db.prepare(`
      INSERT INTO User (id, name, email, role, password, phone, phoneVerifiedAt, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
    `).run('u1', 'User', 'user@test.com', 'customer', hash, '13800000000');
  });

  it('updates password when current password is correct', async () => {
    const res = await passwordPUT(makePutReq({
      currentPassword: 'oldpass123',
      newPassword: 'newpass456',
      stepUpToken: 'grant-token',
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.message).toMatch(/成功/);

    const db = getTestDb();
    const row = db.prepare('SELECT password FROM User WHERE id = ?').get('u1') as { password: string };
    expect(await bcrypt.compare('newpass456', row.password)).toBe(true);
  }, 15000);

  it('returns 400 when current password is wrong', async () => {
    const res = await passwordPUT(makePutReq({
      currentPassword: 'wrongpass',
      newPassword: 'newpass456',
      stepUpToken: 'grant-token',
    }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/当前密码错误/);
  });

  it('returns 400 when fields are missing', async () => {
    const res = await passwordPUT(makePutReq({ currentPassword: 'oldpass123' }));
    expect(res.status).toBe(400);
  });

  it('returns 401 when not logged in', async () => {
    const { requireActiveSession } = await import('@/lib/session');
    (requireActiveSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new NextResponse(JSON.stringify({ error: '未登录' }), { status: 401 }),
    );

    const res = await passwordPUT(makePutReq({
      currentPassword: 'oldpass123',
      stepUpToken: 'grant-token',
      newPassword: 'newpass456',
    }));

    expect(res.status).toBe(401);
  });

  it('returns 401 when the active session has been revoked', async () => {
    const { requireActiveSession } = await import('@/lib/session');
    (requireActiveSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new NextResponse(JSON.stringify({ error: 'Session revoked' }), { status: 401 }),
    );

    const res = await passwordPUT(makePutReq({
      currentPassword: 'oldpass123',
      newPassword: 'newpass456',
      stepUpToken: 'grant-token',
    }));

    expect(res.status).toBe(401);
  });
});
