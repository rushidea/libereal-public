import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

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

function rowOf(id: string): { name: string; identity: string | null } {
  return getTestDb().prepare('SELECT name, identity FROM User WHERE id = ?').get(id) as { name: string; identity: string | null };
}

describe('admin user identity allowlist', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'u_identity', email: 'identity@example.com', name: 'Identity User' });
    db.prepare('UPDATE User SET identity = ? WHERE id = ?').run('教授', 'u_identity');
    requireAdmin.mockReset();
    requireAdmin.mockResolvedValue({
      id: 'admin_test_id',
      email: 'admin@test.com',
      role: 'admin',
    });
  });

  it('accepts customer identities, internal roles, and clearing', async () => {
    const customer = await updateUser(makeReq({ userId: 'u_identity', identity: '医师' }));
    expect(customer.status).toBe(200);
    expect(rowOf('u_identity').identity).toBe('医师');

    const internal = await updateUser(makeReq({ userId: 'u_identity', identity: '代客下单账户' }));
    expect(internal.status).toBe(200);
    expect(rowOf('u_identity').identity).toBe('代客下单账户');

    const cleared = await updateUser(makeReq({ userId: 'u_identity', identity: '  ' }));
    expect(cleared.status).toBe(200);
    expect(rowOf('u_identity').identity).toBeNull();

    getTestDb().prepare('UPDATE User SET identity = ? WHERE id = ?').run('教授', 'u_identity');
    const nulled = await updateUser(makeReq({ userId: 'u_identity', identity: null }));
    expect(nulled.status).toBe(200);
    expect(rowOf('u_identity').identity).toBeNull();
  });

  it('rejects clearing identity with null when the admin lacks customers.write', async () => {
    requireAdmin.mockImplementation(async (permission?: string) => {
      if (permission === 'customers.write') {
        return NextResponse.json({ error: 'Forbidden', requiredPermission: 'customers.write' }, { status: 403 });
      }
      return { id: 'finance_id', email: 'finance@test.com', role: 'admin' };
    });

    const res = await updateUser(makeReq({ userId: 'u_identity', identity: null }));
    expect(res.status).toBe(403);
    expect(requireAdmin).toHaveBeenCalledWith('customers.write');
    expect(rowOf('u_identity')).toEqual({ name: 'Identity User', identity: '教授' });
  });

  it('rejects an accepted identity change without customers.write', async () => {
    requireAdmin.mockImplementation(async (permission?: string) => {
      if (permission === 'customers.write') {
        return NextResponse.json({ error: 'Forbidden', requiredPermission: 'customers.write' }, { status: 403 });
      }
      return { id: 'finance_id', email: 'finance@test.com', role: 'admin' };
    });

    const res = await updateUser(makeReq({ userId: 'u_identity', identity: '医师' }));
    expect(res.status).toBe(403);
    expect(rowOf('u_identity').identity).toBe('教授');
  });

  it('keeps an unchanged legacy identity without customers.write', async () => {
    requireAdmin.mockImplementation(async (permission?: string) => {
      if (permission === 'customers.write') {
        return NextResponse.json({ error: 'Forbidden', requiredPermission: 'customers.write' }, { status: 403 });
      }
      return { id: 'finance_id', email: 'finance@test.com', role: 'admin' };
    });
    getTestDb().prepare('UPDATE User SET identity = ? WHERE id = ?').run('资深副教授', 'u_identity');

    const res = await updateUser(makeReq({ userId: 'u_identity', identity: '资深副教授' }));
    expect(res.status).toBe(200);
    expect(requireAdmin).not.toHaveBeenCalledWith('customers.write');
    expect(rowOf('u_identity').identity).toBe('资深副教授');
  });

  it('rejects identities outside the list and does not write other fields', async () => {
    const res = await updateUser(makeReq({
      userId: 'u_identity',
      name: '不应写入',
      identity: '研究生',
    }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: '身份不在可选列表中' });
    expect(rowOf('u_identity')).toEqual({ name: 'Identity User', identity: '教授' });
  });

  it('keeps an unchanged legacy identity so other profile fields can still be saved', async () => {
    getTestDb().prepare('UPDATE User SET identity = ? WHERE id = ?').run('资深副教授', 'u_identity');
    const res = await updateUser(makeReq({
      userId: 'u_identity',
      name: '已更新',
      identity: '资深副教授',
    }));
    expect(res.status).toBe(200);
    expect(rowOf('u_identity')).toEqual({ name: '已更新', identity: '资深副教授' });
  });
});
