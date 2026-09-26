import { describe, it, expect, beforeAll, beforeEach, vi, afterAll } from 'vitest';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));
vi.mock('@/lib/security/security-session-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/security-session-service')>();
  return {
    ...actual,
    getSecuritySessionState: vi.fn().mockResolvedValue({ known: true, active: true }),
    touchSecuritySession: vi.fn().mockResolvedValue(true),
    hasRecentSecuritySessionMfa: vi.fn().mockResolvedValue(false),
  };
});

import { PATCH, GET } from '@/app/api/admin/users/[id]/route';
import { NextRequest } from 'next/server';
import { getTestDb, closeTestDb, seedUser, seedAdmin } from './db-helpers';

describe('PATCH /api/admin/users/[id]', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    db.exec('DELETE FROM User');
    db.exec('DELETE FROM PointsLog');
    db.exec('DELETE FROM AuditLog');
    seedAdmin(db);
    seedUser(db, { id: 'u1', email: 'u1@test.com', points: 100, tier: 'standard' });
    seedUser(db, { id: 'u2', email: 'u2@test.com', points: 200, tier: 'tier-2' });
  });

  function makePatch(id: string, body: object): NextRequest {
    return new NextRequest(`http://localhost:3000/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('updates single field: tier', async () => {
    const res = await PATCH(makePatch('u1', { tier: 'tier-5' }) as NextRequest, {
      params: Promise.resolve({ id: 'u1' }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.user.tier).toBe('tier-5');

    const db = getTestDb();
    const u1 = db.prepare('SELECT tier FROM User WHERE id = ?').get('u1') as { tier: string };
    expect(u1.tier).toBe('tier-5');
  });

  it('updates discountRate to 0.8 (8折)', async () => {
    const res = await PATCH(makePatch('u1', { discountRate: 0.8 }) as NextRequest, {
      params: Promise.resolve({ id: 'u1' }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.user.discountRate).toBe(0.8);
  });

  it('updates brandDiscounts as JSON object', async () => {
    const res = await PATCH(makePatch('u1', {
      brandDiscounts: { 'CST': 0.85, 'Abcam': 0.9 },
    }) as NextRequest, {
      params: Promise.resolve({ id: 'u1' }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.user.brandDiscounts).toBe('{"CST":0.85,"Abcam":0.9}'); // stored as JSON string
  });

  it('updates points (admin sets to 500)', async () => {
    const res = await PATCH(makePatch('u1', { points: 500 }) as NextRequest, {
      params: Promise.resolve({ id: 'u1' }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.user.points).toBe(500);

    const log = getTestDb().prepare('SELECT delta, type FROM PointsLog WHERE userId = ?').get('u1') as { delta: number; type: string };
    expect(log).toEqual({ delta: 400, type: 'admin_adjust' });
  });

  it('rejects a points balance above the shared maximum', async () => {
    const res = await PATCH(makePatch('u1', { points: 1000001 }) as NextRequest, {
      params: Promise.resolve({ id: 'u1' }),
    });
    expect(res.status).toBe(400);
    expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('u1')).toEqual({ points: 100 });
  });

  it('updates multiple fields at once', async () => {
    const res = await PATCH(makePatch('u1', {
      name: '新名字',
      phone: '13800001111',
      institution: '清华大学',
      points: 999,
    }) as NextRequest, {
      params: Promise.resolve({ id: 'u1' }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.user.name).toBe('新名字');
    expect(json.user.phone).toBe('13800001111');
    expect(json.user.institution).toBe('清华大学');
    expect(json.user.points).toBe(999);
  });

  it('returns 404 for non-existent user', async () => {
    const res = await PATCH(makePatch('nonexistent', { tier: 'tier-5' }) as NextRequest, {
      params: Promise.resolve({ id: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });

  it('handles empty update (no fields) gracefully', async () => {
    const res = await PATCH(makePatch('u1', {}) as NextRequest, {
      params: Promise.resolve({ id: 'u1' }),
    });
    expect(res.status).toBe(200);
    // u1 unchanged
    const db = getTestDb();
    const u1 = db.prepare('SELECT tier, points FROM User WHERE id = ?').get('u1') as { tier: string; points: number };
    expect(u1.tier).toBe('standard');
    expect(u1.points).toBe(100);
  });
});

describe('GET /api/admin/users/[id]', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    db.exec('DELETE FROM User');
    seedAdmin(db);
    seedUser(db, { id: 'u1', email: 'u1@test.com' });
  });

  it('returns customer users by default', async () => {
    const res = await GET(new NextRequest('http://localhost:3000/api/admin/users') as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    // 1 customer (u1) + admin... wait, GET filters by role='customer' by default
    expect(json.users.length).toBe(1);
    expect(json.users[0].email).toBe('u1@test.com');
  });

  it('returns brandDiscounts parsed to object', async () => {
    // seed u1 with brandDiscounts
    const db = getTestDb();
    db.prepare('UPDATE User SET brandDiscounts = ? WHERE id = ?').run('{"CST":0.85}', 'u1');

    const res = await GET(new NextRequest('http://localhost:3000/api/admin/users') as NextRequest);
    const json = await res.json();
    expect(json.users[0].brandDiscounts).toEqual({ CST: 0.85 });
  });
});
