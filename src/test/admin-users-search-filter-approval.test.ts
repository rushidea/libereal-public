import { describe, it, expect, beforeAll, beforeEach, vi, afterAll } from 'vitest';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));

import { GET as searchGET } from '@/app/api/admin/users/search/route';
import { GET as filterGET } from '@/app/api/admin/users/filter/route';
import { POST as approvalPOST } from '@/app/api/admin/users/approval/route';
import { NextRequest } from 'next/server';
import { getTestDb, closeTestDb, seedUser, seedAdmin, clearAllTables } from './db-helpers';

describe('GET /api/admin/users/search', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'u1', email: 'alice@example.com', name: 'Alice', points: 500 });
    seedUser(db, { id: 'u2', email: 'bob@example.com', name: 'Bob', points: 300 });
    seedUser(db, { id: 'u3', email: 'carol@school.edu', name: 'Carol Zhang', points: 200 });
  });

  function makeReq(q: string): NextRequest {
    return new NextRequest(`http://localhost:3000/api/admin/users/search?q=${encodeURIComponent(q)}`);
  }

  it('returns empty array when q is empty', async () => {
    const res = await searchGET(new NextRequest('http://localhost:3000/api/admin/users/search') as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.users).toEqual([]);
  });

  it('searches by email substring', async () => {
    const res = await searchGET(makeReq('alice') as NextRequest);
    const json = await res.json();
    expect(json.users).toHaveLength(1);
    expect(json.users[0].email).toBe('alice@example.com');
  });

  it('searches by name substring', async () => {
    const res = await searchGET(makeReq('Carol') as NextRequest);
    const json = await res.json();
    expect(json.users.length).toBeGreaterThan(0);
    expect(json.users.some((u: { name: string }) => u.name.includes('Carol'))).toBe(true);
  });

  it('orders by points DESC (highest first)', async () => {
    const res = await searchGET(makeReq('example.com') as NextRequest);
    const json = await res.json();
    // alice (500) should come before bob (300)
    expect(json.users[0].email).toBe('alice@example.com');
    expect(json.users[1].email).toBe('bob@example.com');
  });

  it('respects limit param (capped at 50)', async () => {
    const res = await searchGET(new NextRequest('http://localhost:3000/api/admin/users/search?q=a&limit=2') as NextRequest);
    const json = await res.json();
    expect(json.users.length).toBeLessThanOrEqual(2);
  });
});

describe('GET /api/admin/users/filter', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'u1', email: 'u1@tsinghua.edu.cn', name: '清华小张', points: 50, tier: 'standard', institution: '清华大学' });
    seedUser(db, { id: 'u2', email: 'u2@tsinghua.edu.cn', name: '清华小王', points: 500, tier: 'tier-3', institution: '清华大学' });
    seedUser(db, { id: 'u3', email: 'u3@pku.edu.cn', name: '北大李', points: 2000, tier: 'tier-4', institution: '北京大学' });
    seedUser(db, { id: 'u4', email: 'u4@fudan.edu.cn', name: '复旦陈', points: 50, tier: 'standard', institution: '复旦大学' });
  });

  function makeReq(params: Record<string, string>): NextRequest {
    const qs = new URLSearchParams(params).toString();
    return new NextRequest(`http://localhost:3000/api/admin/users/filter?${qs}`);
  }

  it('returns all users (admin + customers) with total count and facets', async () => {
    const res = await filterGET(makeReq({}) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    // 5 total: admin + 4 customers
    expect(json.total).toBe(5);
    expect(json.facets.institutions).toContain('清华大学');
    expect(json.facets.departments).toEqual([]); // no department set
  });

  it('filters by tier (multiple values)', async () => {
    const res = await filterGET(makeReq({ tiers: 'standard,tier-3' }) as NextRequest);
    const json = await res.json();
    // admin (standard) + u1 (standard) + u2 (tier-3) + u4 (standard) = 4
    expect(json.total).toBe(4);
    const tiers = json.users.map((u: { tier: string }) => u.tier);
    expect(new Set(tiers)).toEqual(new Set(['standard', 'tier-3']));
  });

  it('filters by institution substring', async () => {
    const res = await filterGET(makeReq({ institution: '清华' }) as NextRequest);
    const json = await res.json();
    expect(json.total).toBe(2); // u1, u2
  });

  it('filters by points range (min and max)', async () => {
    const res = await filterGET(makeReq({ pointsMin: '100', pointsMax: '1000' }) as NextRequest);
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.users[0].id).toBe('u2');
  });

  it('pointsMax 1000 returns 4 (admin + u1 + u2 + u4) under 1000', async () => {
    const res = await filterGET(makeReq({ pointsMax: '1000' }) as NextRequest);
    const json = await res.json();
    expect(json.total).toBe(4);
  });

  it('paginates with limit and offset', async () => {
    const res = await filterGET(makeReq({ limit: '2', offset: '0' }) as NextRequest);
    const json = await res.json();
    expect(json.users.length).toBe(2);
    expect(json.total).toBe(5);
  });

  it('combines multiple filters (AND)', async () => {
    const res = await filterGET(makeReq({ institution: '清华', tiers: 'standard' }) as NextRequest);
    const json = await res.json();
    expect(json.total).toBe(1);
    expect(json.users[0].id).toBe('u1');
  });
});

describe('POST /api/admin/users/approval', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'u1', email: 'u1@test.com', name: 'Pending User' });
    db.prepare('UPDATE User SET approvalStatus = ?, isNewUser = 1 WHERE id = ?').run('pending', 'u1');
  });

  function makeReq(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/users/approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('approves user: sets approvalStatus=approved, isNewUser=0, sends notification', async () => {
    const previous = process.env.MFA_ADMIN_REQUIRED;
    process.env.MFA_ADMIN_REQUIRED = 'true';
    try {
    const res = await approvalPOST(makeReq({ userId: 'u1', action: 'approve' }) as NextRequest);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    const db = getTestDb();
    const u1 = db.prepare('SELECT approvalStatus, isNewUser FROM User WHERE id = ?').get('u1') as { approvalStatus: string; isNewUser: number };
    expect(u1.approvalStatus).toBe('approved');
    expect(u1.isNewUser).toBe(0);

    const notifs = db.prepare('SELECT * FROM Notification WHERE email = ?').all('u1@test.com') as Array<{ title: string; type: string }>;
    expect(notifs).toHaveLength(1);
    expect(notifs[0].title).toMatch(/审核通过/);
    } finally {
      if (previous === undefined) delete process.env.MFA_ADMIN_REQUIRED;
      else process.env.MFA_ADMIN_REQUIRED = previous;
    }
  });

  it('rejects user: sets approvalStatus=rejected, sends notification', async () => {
    const res = await approvalPOST(makeReq({ userId: 'u1', action: 'reject' }) as NextRequest);
    expect(res.status).toBe(200);

    const db = getTestDb();
    const u1 = db.prepare('SELECT approvalStatus, isNewUser FROM User WHERE id = ?').get('u1') as { approvalStatus: string; isNewUser: number };
    expect(u1.approvalStatus).toBe('rejected');
    // reject 不动 isNewUser
    expect(u1.isNewUser).toBe(1);
  });

  it('returns 404 for non-existent user', async () => {
    const res = await approvalPOST(makeReq({ userId: 'nonexistent', action: 'approve' }) as NextRequest);
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing action', async () => {
    const res = await approvalPOST(makeReq({ userId: 'u1' }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid action', async () => {
    const res = await approvalPOST(makeReq({ userId: 'u1', action: 'ban' }) as NextRequest);
    expect(res.status).toBe(400);
  });
});
