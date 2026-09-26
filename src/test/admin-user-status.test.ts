import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { getTestDb, closeTestDb, clearAllTables, seedAdmin, seedUser } from './db-helpers';

const { requireAdmin } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ requireAdmin }));

import { PUT as updateUser } from '@/app/api/admin/users/update/route';

function makeReq(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/users/update', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('admin user status update', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'u_status', email: 'status@example.com', name: 'Status User' });
    db.prepare('UPDATE User SET identity = ?, brandDiscounts = ? WHERE id = ?').run(
      '研究生',
      JSON.stringify({ CST: 0.85 }),
      'u_status',
    );
    requireAdmin.mockReset();
    requireAdmin.mockResolvedValue({
      id: 'admin_test_id',
      email: 'admin@test.com',
      role: 'admin',
    });
  });

  it('updates approval, order restriction, and frozen status and notifies the user', async () => {
    const res = await updateUser(makeReq({
      userId: 'u_status',
      approvalStatus: 'rejected',
      isBlacklisted: true,
      isFrozen: true,
    }));

    expect(res.status).toBe(200);
    const user = getTestDb().prepare(
      'SELECT approvalStatus, isBlacklisted, isFrozen FROM User WHERE id = ?',
    ).get('u_status') as { approvalStatus: string; isBlacklisted: number; isFrozen: number };
    expect(user).toEqual({ approvalStatus: 'rejected', isBlacklisted: 1, isFrozen: 1 });

    const notification = getTestDb().prepare(
      'SELECT title, content FROM Notification WHERE email = ?',
    ).get('status@example.com') as { title: string; content: string };
    expect(notification.title).toBe('账户状态更新');
    expect(notification.content).toContain('账户已冻结');
    expect(notification.content).toContain('无法看到折扣价格');
    expect(notification.content).toContain('无法提交订单或询价');
    const audit = getTestDb().prepare('SELECT action, resource, targetId FROM AuditLog WHERE targetId = ?').get('u_status');
    expect(audit).toEqual({ action: 'customer.account_status_changed', resource: 'customers', targetId: 'u_status' });
  });

  it('rejects status changes for administrator accounts', async () => {
    const res = await updateUser(makeReq({ userId: 'admin_test_id', isFrozen: true }));
    expect(res.status).toBe(403);
  });

  it('returns 403 when customer_admin promotes a user to admin without roles.manage', async () => {
    requireAdmin.mockImplementation(async (permission?: string) => {
      if (permission === 'roles.manage') {
        return NextResponse.json({ error: 'Forbidden', requiredPermission: 'roles.manage' }, { status: 403 });
      }
      return { id: 'customer_admin_id', email: 'customer-admin@test.com', role: 'admin' };
    });

    const res = await updateUser(makeReq({ userId: 'u_status', role: 'admin' }));
    expect(res.status).toBe(403);
    expect(requireAdmin).toHaveBeenCalledWith('roles.manage');
    const row = getTestDb().prepare('SELECT role FROM User WHERE id = ?').get('u_status') as { role: string };
    expect(row.role).toBe('customer');
  });

  it('accepts empty brandDiscounts as null and keeps profile fields when validation fails', async () => {
    const bad = await updateUser(makeReq({
      userId: 'u_status',
      name: '不应写入',
      brandDiscounts: '{not-json',
    }));
    expect(bad.status).toBe(400);
    const unchanged = getTestDb().prepare(
      'SELECT name, identity, brandDiscounts FROM User WHERE id = ?',
    ).get('u_status') as { name: string; identity: string; brandDiscounts: string };
    expect(unchanged.name).toBe('Status User');
    expect(unchanged.identity).toBe('研究生');
    expect(unchanged.brandDiscounts).toBe(JSON.stringify({ CST: 0.85 }));

    const ok = await updateUser(makeReq({
      userId: 'u_status',
      name: '更新后的名字',
      identity: '研究生',
      brandDiscounts: '',
    }));
    expect(ok.status).toBe(200);
    const updated = getTestDb().prepare(
      'SELECT name, identity, brandDiscounts FROM User WHERE id = ?',
    ).get('u_status') as { name: string; identity: string; brandDiscounts: string | null };
    expect(updated.name).toBe('更新后的名字');
    expect(updated.identity).toBe('研究生');
    expect(updated.brandDiscounts).toBeNull();
  });

  it('rejects role admin + isFrozen in one request with zero writes', async () => {
    const before = getTestDb().prepare(
      'SELECT role, isFrozen, name FROM User WHERE id = ?',
    ).get('u_status') as { role: string; isFrozen: number; name: string };

    const res = await updateUser(makeReq({
      userId: 'u_status',
      role: 'admin',
      isFrozen: true,
      name: '不应变成管理员',
    }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/冻结|管理员/);
    const after = getTestDb().prepare(
      'SELECT role, isFrozen, name FROM User WHERE id = ?',
    ).get('u_status') as { role: string; isFrozen: number; name: string };
    expect(after).toEqual(before);
  });

  it('rejects promoting an already-frozen account to admin with only role field', async () => {
    getTestDb().prepare('UPDATE User SET isFrozen = 1 WHERE id = ?').run('u_status');
    const before = getTestDb().prepare(
      'SELECT role, isFrozen, name FROM User WHERE id = ?',
    ).get('u_status') as { role: string; isFrozen: number; name: string };

    const res = await updateUser(makeReq({
      userId: 'u_status',
      role: 'admin',
      name: '已冻结不应升管理员',
    }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/冻结|管理员/);
    const after = getTestDb().prepare(
      'SELECT role, isFrozen, name FROM User WHERE id = ?',
    ).get('u_status') as { role: string; isFrozen: number; name: string };
    expect(after).toEqual(before);
  });
});
