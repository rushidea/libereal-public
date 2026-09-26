import { describe, it, expect, beforeAll, beforeEach, vi, afterAll } from 'vitest';

console.log('[test] DATABASE_PATH =', process.env.DATABASE_PATH);

// Mock auth + DB before any imports
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { POST } from '@/app/api/admin/points/adjust/route';
import { NextRequest } from 'next/server';
import { getTestDb, closeTestDb, seedUser, seedAdmin } from './db-helpers';

describe('POST /api/admin/points/adjust', () => {
  beforeAll(() => {
    getTestDb(); // 初始化 singleton + 设 env var
  });
  afterAll(() => {
    closeTestDb();
  });
  beforeEach(() => {
    const db = getTestDb();
    db.exec('DELETE FROM PointsLog');
    db.exec('DELETE FROM AuditLog');
    db.exec('DELETE FROM User');
    seedAdmin(db);
    seedUser(db, { id: 'user_1', email: 'user1@test.com', name: 'User 1', points: 100, tier: 'standard' });
  });

  function makeRequest(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/points/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('adds points and writes PointsLog', async () => {
    const res = await POST(makeRequest({ userId: 'user_1', delta: 50, reason: '测试加 50' }) as NextRequest);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.newPoints).toBe(150);

    const db = getTestDb();
    const user = db.prepare('SELECT points, tier FROM User WHERE id = ?').get('user_1') as { points: number; tier: string };
    expect(user.points).toBe(150);

    const logs = db.prepare('SELECT * FROM PointsLog WHERE userId = ?').all('user_1') as Array<{ delta: number; type: string; adminEmail: string }>;
    expect(logs).toHaveLength(1);
    expect(logs[0].delta).toBe(50);
    expect(logs[0].type).toBe('admin_adjust');
    expect(logs[0].adminEmail).toBe('admin@test.com');
    const audit = db.prepare('SELECT action, resource, targetId FROM AuditLog WHERE targetId = ?').get('user_1');
    expect(audit).toEqual({ action: 'points.adjusted', resource: 'points', targetId: 'user_1' });
  });

  it('supports setting a user balance and returns the complete adjustment summary', async () => {
    const res = await POST(makeRequest({ userId: 'user_1', setTo: 250, reason: '设置为 250' }) as NextRequest);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: true, oldPoints: 100, newPoints: 250, delta: 150, userEmail: 'user1@test.com' });
    expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('user_1')).toEqual({ points: 250 });
  });

  it('allows setting a balance to zero but rejects an invalid target', async () => {
    const zeroRes = await POST(makeRequest({ userId: 'user_1', setTo: 0, reason: '清零' }) as NextRequest);
    expect(zeroRes.status).toBe(200);

    const invalidRes = await POST(makeRequest({ userId: 'user_1', setTo: -1, reason: '无效' }) as NextRequest);
    expect(invalidRes.status).toBe(400);
  });

  it('does not change membership tier when points change', async () => {
    // user_1 starts at 100 tier-2 (1 ≤ 100 < 101)，+50 = 150 → tier-3 (101 ≤ 150 < 1001)
    const res = await POST(makeRequest({ userId: 'user_1', delta: 50, reason: '从 100 加到 150 = tier-3' }) as NextRequest);
    const json = await res.json();
    expect(json.newTier).toBeUndefined();

    const db = getTestDb();
    const user = db.prepare('SELECT tier FROM User WHERE id = ?').get('user_1') as { tier: string };
    expect(user.tier).toBe('standard');
  });

  it('returns 400 for invalid delta (non-integer)', async () => {
    const res = await POST(makeRequest({ userId: 'user_1', delta: 1.5, reason: '无效' }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 400 for zero delta', async () => {
    const res = await POST(makeRequest({ userId: 'user_1', delta: 0, reason: '不变' }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 400 for delta exceeding 1,000,000', async () => {
    const res = await POST(makeRequest({ userId: 'user_1', delta: 1000001, reason: '太大' }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('rejects a delta that would push the final balance above the maximum', async () => {
    getTestDb().prepare('UPDATE User SET points = ? WHERE id = ?').run(500000, 'user_1');
    const res = await POST(makeRequest({ userId: 'user_1', delta: 1000000, reason: '超过余额上限' }) as NextRequest);
    expect(res.status).toBe(400);
    expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('user_1')).toEqual({ points: 500000 });
  });

  it('returns 400 when resulting balance is negative', async () => {
    const res = await POST(makeRequest({ userId: 'user_1', delta: -500, reason: '扣超' }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent user', async () => {
    const res = await POST(makeRequest({ userId: 'no_such_user', delta: 50, reason: '找不到' }) as NextRequest);
    expect(res.status).toBe(404);
  });

  it('rejects subtraction when user has insufficient points', async () => {
    // user_1 starts at 100, -200 = -100 → 400
    const res = await POST(makeRequest({ userId: 'user_1', delta: -200, reason: '扣太多' }) as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/积分不足|积分不能为负|服务器/);
  });

  it('requires administrator MFA before changing points when the policy is enabled', async () => {
    const previous = process.env.MFA_ADMIN_REQUIRED;
    process.env.MFA_ADMIN_REQUIRED = 'true';
    try {
      const res = await POST(makeRequest({ userId: 'user_1', delta: 50, reason: '需要确认身份' }) as NextRequest);
      expect(res.status).toBe(403);
      expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('user_1')).toEqual({ points: 100 });
      expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM PointsLog WHERE userId = ?').get('user_1')).toEqual({ count: 0 });
    } finally {
      if (previous === undefined) delete process.env.MFA_ADMIN_REQUIRED;
      else process.env.MFA_ADMIN_REQUIRED = previous;
    }
  });
});
