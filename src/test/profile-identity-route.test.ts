import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

const { requireActiveSession } = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ requireActiveSession }));

import { PUT as setIdentity } from '@/app/api/profile/identity/route';

function makeReq(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/profile/identity', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function identityOf(id: string): string | null {
  const row = getTestDb().prepare('SELECT identity FROM User WHERE id = ?').get(id) as { identity: string | null };
  return row.identity;
}

describe('PUT /api/profile/identity', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedUser(db, { id: 'self_user', email: 'self@example.com', name: 'Self' });
    seedUser(db, { id: 'other_user', email: 'other@example.com', name: 'Other' });
    requireActiveSession.mockReset();
    requireActiveSession.mockResolvedValue({
      id: 'self_user',
      email: 'self@example.com',
      role: 'customer',
      sessionId: 'session-self',
    });
  });

  it('requires the signed-in user', async () => {
    requireActiveSession.mockResolvedValue(NextResponse.json({ error: '未登录' }, { status: 401 }));
    const res = await setIdentity(makeReq({ identity: '教授' }));
    expect(res.status).toBe(401);
    expect(identityOf('self_user')).toBeNull();
  });

  it('lets the account choose a customer identity once when empty or legacy', async () => {
    const first = await setIdentity(makeReq({ identity: ' 硕士研究生 ', userId: 'other_user' }));
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ success: true, identity: '硕士研究生' });
    expect(identityOf('self_user')).toBe('硕士研究生');
    expect(identityOf('other_user')).toBeNull();

    const locked = await setIdentity(makeReq({ identity: '教授' }));
    expect(locked.status).toBe(403);
    expect(identityOf('self_user')).toBe('硕士研究生');

    getTestDb().prepare('UPDATE User SET identity = ? WHERE id = ?').run('资深副教授', 'self_user');
    const legacy = await setIdentity(makeReq({ identity: '医师' }));
    expect(legacy.status).toBe(200);
    expect(identityOf('self_user')).toBe('医师');
  });

  it('does not let an internal-role account choose an identity', async () => {
    getTestDb().prepare('UPDATE User SET identity = ? WHERE id = ?').run('内部员工', 'self_user');
    const res = await setIdentity(makeReq({ identity: '学生' }));
    expect(res.status).toBe(403);
    expect(identityOf('self_user')).toBe('内部员工');
  });

  it('rejects a second selection after the identity is saved', async () => {
    const first = await setIdentity(makeReq({ identity: '学生' }));
    expect(first.status).toBe(200);
    const second = await setIdentity(makeReq({ identity: '教授' }));
    expect(second.status).toBe(403);
    expect(identityOf('self_user')).toBe('学生');
  });

  it('rejects self-select for administrator accounts', async () => {
    getTestDb().prepare('UPDATE User SET role = ? WHERE id = ?').run('admin', 'self_user');
    const res = await setIdentity(makeReq({ identity: '教授' }));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: '管理员账户不能自选身份' });
    expect(identityOf('self_user')).toBeNull();
  });

  it('rejects internal roles, unknown values, and accounts that already have an internal role', async () => {
    const internalChoice = await setIdentity(makeReq({ identity: '内部员工' }));
    expect(internalChoice.status).toBe(400);
    expect(identityOf('self_user')).toBeNull();

    const unknown = await setIdentity(makeReq({ identity: '研究生' }));
    expect(unknown.status).toBe(400);
    expect(identityOf('self_user')).toBeNull();

    getTestDb().prepare('UPDATE User SET identity = ? WHERE id = ?').run('测试账号', 'self_user');
    const lockedInternal = await setIdentity(makeReq({ identity: '学生' }));
    expect(lockedInternal.status).toBe(403);
    expect(identityOf('self_user')).toBe('测试账号');
  });
});
