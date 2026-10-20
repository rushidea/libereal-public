import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin }));

import { GET } from '@/app/api/users/route';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

describe('GET /api/users', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, {
      id: 'customer_1',
      email: 'customer@example.com',
      school: '南京医科大学',
      college: '基础医学部',
      major: '基础医学系',
      piLab: '李教授实验室',
      affiliatedLab: '综合实验室',
      institutionType: '高校',
      institutionName: '南京医科大学',
      institutionUnit: '基础医学部',
      institutionFacility: '医学楼A座',
    });
    requireAdmin.mockReset();
    requireAdmin.mockResolvedValue({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin' });
  });

  it('returns 401 without a session', async () => {
    requireAdmin.mockResolvedValue(NextResponse.json({ error: '未登录' }, { status: 401 }));
    expect((await GET()).status).toBe(401);
    expect(requireAdmin).toHaveBeenCalledWith('customers.read');
  });

  it('returns 403 for a customer account', async () => {
    requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await GET()).status).toBe(403);
  });

  it('returns the customer list with customers.read permission', async () => {
    getTestDb().prepare('UPDATE User SET identity = ? WHERE id = ?').run('PI', 'customer_1');
    const response = await GET();
    expect(response.status).toBe(200);
    const users = await response.json();
    expect(Array.isArray(users)).toBe(true);
    const customer = users.find((user: { id: string }) => user.id === 'customer_1');
    expect(customer).toBeTruthy();
    expect(customer.identity).toBe('PI');
    expect(customer.school).toBe('南京医科大学');
    expect(customer.institutionType).toBe('高校');
    expect(customer.institutionName).toBe('南京医科大学');
    expect(customer.institutionUnit).toBe('基础医学部');
    expect(customer.institutionFacility).toBe('医学楼A座');
    expect(customer.college).toBe('基础医学部');
    expect(customer.major).toBe('基础医学系');
    expect(customer.piLab).toBe('李教授实验室');
    expect(customer.affiliatedLab).toBe('综合实验室');
    expect(customer.lastLoginAt).toBeNull();
  });

  it('includes the latest session activity as lastLoginAt for customers.read', async () => {
    const seenAt = '2026-03-01T08:30:00.000Z';
    getTestDb().prepare(
      `INSERT INTO user_sessions (id, user_id, session_id, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('sess_customer_1', 'customer_1', 'session_customer_1', seenAt, seenAt);

    const response = await GET();
    expect(response.status).toBe(200);
    const users = await response.json();
    const customer = users.find((user: { id: string }) => user.id === 'customer_1');
    expect(new Date(customer.lastLoginAt).toISOString()).toBe(seenAt);
  });
});
