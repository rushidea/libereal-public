import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { getTestDb, closeTestDb, clearAllTables, seedAdmin, seedUser } from './db-helpers';

const { requireAdmin } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ requireAdmin }));

import { POST, PATCH } from '@/app/api/admin/users/route';

function makePost(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePatch(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/users', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/users create', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    requireAdmin.mockReset();
    requireAdmin.mockResolvedValue({
      id: 'admin_test_id',
      email: 'admin@test.com',
      role: 'admin',
    });
  });

  it('creates a customer with hashed password and profile fields', async () => {
    const res = await POST(makePost({
      name: '新建用户',
      email: 'new.user@Example.com',
      password: 'password123',
      role: 'customer',
      institution: '测试大学',
      department: '生物系',
      phone: '13800138000',
      tier: 'tier-2',
      approvalStatus: 'approved',
    }) as unknown as Request);

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.user.email).toBe('new.user@example.com');
    expect(json.user.name).toBe('新建用户');
    expect(json.user.tier).toBe('tier-2');
    expect(json.user.role).toBe('customer');
    expect(json.user.isFrozen).toBe(false);
    expect(requireAdmin).toHaveBeenCalledWith('customers.write');
    expect(requireAdmin).not.toHaveBeenCalledWith('roles.manage');

    const row = getTestDb().prepare(
      'SELECT email, password, institution, department, phone, approvalStatus FROM User WHERE email = ?',
    ).get('new.user@example.com') as {
      email: string;
      password: string;
      institution: string;
      department: string;
      phone: string;
      approvalStatus: string;
    };
    expect(row.institution).toBe('测试大学');
    expect(row.department).toBe('生物系');
    expect(row.phone).toBe('13800138000');
    expect(row.approvalStatus).toBe('approved');
    expect(row.password).not.toBe('password123');
    expect(row.password.length).toBeGreaterThan(20);
  });

  it('rejects duplicate email and short password', async () => {
    const first = await POST(makePost({
      email: 'dup@example.com',
      password: 'password123',
    }) as unknown as Request);
    expect(first.status).toBe(201);

    const dup = await POST(makePost({
      email: 'DUP@example.com',
      password: 'password123',
    }) as unknown as Request);
    expect(dup.status).toBe(409);

    const short = await POST(makePost({
      email: 'short@example.com',
      password: 'short',
    }) as unknown as Request);
    expect(short.status).toBe(400);
  });

  it('returns 403 when customer_admin creates role admin without roles.manage', async () => {
    requireAdmin.mockImplementation(async (permission?: string) => {
      if (permission === 'roles.manage') {
        return NextResponse.json({ error: 'Forbidden', requiredPermission: 'roles.manage' }, { status: 403 });
      }
      return { id: 'customer_admin_id', email: 'customer-admin@test.com', role: 'admin' };
    });

    const res = await POST(makePost({
      email: 'new-admin@example.com',
      password: 'password123',
      role: 'admin',
    }) as unknown as Request);

    expect(res.status).toBe(403);
    expect(requireAdmin).toHaveBeenCalledWith('customers.write');
    expect(requireAdmin).toHaveBeenCalledWith('roles.manage');
    const created = getTestDb().prepare('SELECT id FROM User WHERE email = ?').get('new-admin@example.com');
    expect(created).toBeUndefined();
  });

  it('bulk freezes and unfreezes non-admin users', async () => {
    const created = await POST(makePost({
      email: 'freeze.me@example.com',
      password: 'password123',
    }) as unknown as Request);
    const { user } = await created.json();

    const freeze = await PATCH(makePatch({
      userIds: [user.id],
      action: 'freeze',
    }) as unknown as Request);
    expect(freeze.status).toBe(200);
    const frozen = getTestDb().prepare('SELECT isFrozen FROM User WHERE id = ?').get(user.id) as { isFrozen: number };
    expect(frozen.isFrozen).toBe(1);

    const unfreeze = await PATCH(makePatch({
      userIds: [user.id],
      action: 'unfreeze',
    }) as unknown as Request);
    expect(unfreeze.status).toBe(200);
    const thawed = getTestDb().prepare('SELECT isFrozen FROM User WHERE id = ?').get(user.id) as { isFrozen: number };
    expect(thawed.isFrozen).toBe(0);
  });

  it('returns 403 and changes nothing when freeze selection includes an admin', async () => {
    seedUser(getTestDb(), { id: 'u_freeze', email: 'freeze-target@example.com' });

    const freeze = await PATCH(makePatch({
      userIds: ['u_freeze', 'admin_test_id'],
      action: 'freeze',
    }) as unknown as Request);

    expect(freeze.status).toBe(403);
    const body = await freeze.json();
    expect(body.error).toContain('管理员');
    const customer = getTestDb().prepare('SELECT isFrozen FROM User WHERE id = ?').get('u_freeze') as { isFrozen: number };
    const admin = getTestDb().prepare('SELECT isFrozen FROM User WHERE id = ?').get('admin_test_id') as { isFrozen: number };
    expect(customer.isFrozen).toBe(0);
    expect(admin.isFrozen).toBe(0);
  });
});
