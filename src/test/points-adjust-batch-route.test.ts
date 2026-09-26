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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { POST } from '@/app/api/admin/points/adjust-batch/route';
import { NextRequest } from 'next/server';
import { getTestDb, closeTestDb, seedUser, seedAdmin } from './db-helpers';

describe('POST /api/admin/points/adjust-batch', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    db.exec('DELETE FROM PointsLog');
    db.exec('DELETE FROM AuditLog');
    db.exec('DELETE FROM User');
    seedAdmin(db);
    seedUser(db, { id: 'u1', email: 'u1@test.com', points: 100 });
    seedUser(db, { id: 'u2', email: 'u2@test.com', points: 200 });
    seedUser(db, { id: 'u3', email: 'u3@test.com', points: 50 });
  });

  function makeRequest(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/points/adjust-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('adds points to multiple users, reports success/failure counts', async () => {
    const res = await POST(makeRequest({
      emails: ['u1@test.com', 'u2@test.com', 'u3@test.com', 'nonexistent@test.com'],
      mode: 'add',
      amount: 50,
      reason: '测试批量加 50',
    }) as NextRequest);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.succeededCount).toBe(3);
    expect(json.failedCount).toBe(1);

    const db = getTestDb();
    const u1 = db.prepare('SELECT points FROM User WHERE id = ?').get('u1') as { points: number };
    expect(u1.points).toBe(150);
    const u3 = db.prepare('SELECT points FROM User WHERE id = ?').get('u3') as { points: number };
    expect(u3.points).toBe(100);

    // 3 个成功都写 PointsLog
    const logs = db.prepare('SELECT * FROM PointsLog').all() as Array<{ delta: number; type: string }>;
    expect(logs).toHaveLength(3);
    expect(logs.every(l => l.delta === 50 && l.type === 'admin_adjust')).toBe(true);
  });

  it('subtracts mode: -50 from each', async () => {
    const res = await POST(makeRequest({
      emails: ['u1@test.com', 'u2@test.com'],
      mode: 'subtract',
      amount: 50,
      reason: '扣 50',
    }) as NextRequest);
    const json = await res.json();
    expect(json.succeededCount).toBe(2);

    const db = getTestDb();
    const u1 = db.prepare('SELECT points FROM User WHERE id = ?').get('u1') as { points: number };
    expect(u1.points).toBe(50);
  });

  it('rejects when one user has insufficient points (partial success)', async () => {
    // u3 只有 50，扣 100 会失败
    const res = await POST(makeRequest({
      emails: ['u1@test.com', 'u3@test.com'],
      mode: 'subtract',
      amount: 100,
      reason: '扣 100',
    }) as NextRequest);
    const json = await res.json();
    expect(json.succeededCount).toBe(1);
    expect(json.failedCount).toBe(1);
    expect(json.failed[0].email).toBe('u3@test.com');
    expect(json.failed[0].reason).toMatch(/积分不足/);

    const db = getTestDb();
    const u1 = db.prepare('SELECT points FROM User WHERE id = ?').get('u1') as { points: number };
    expect(u1.points).toBe(0); // 100-100
    const u3 = db.prepare('SELECT points FROM User WHERE id = ?').get('u3') as { points: number };
    expect(u3.points).toBe(50); // 未变
  });

  it('set mode: directly sets to amount', async () => {
    const res = await POST(makeRequest({
      emails: ['u1@test.com', 'u2@test.com'],
      mode: 'set',
      amount: 500,
      reason: '设为 500',
    }) as NextRequest);
    const json = await res.json();
    expect(json.succeededCount).toBe(2);

    const db = getTestDb();
    const u1 = db.prepare('SELECT points FROM User WHERE id = ?').get('u1') as { points: number };
    const u2 = db.prepare('SELECT points FROM User WHERE id = ?').get('u2') as { points: number };
    expect(u1.points).toBe(500);
    expect(u2.points).toBe(500);

    // set 模式也写日志，delta = new - old
    const u1Log = db.prepare("SELECT delta FROM PointsLog WHERE userId = 'u1'").get() as { delta: number };
    expect(u1Log.delta).toBe(400); // 500 - 100
  });

  it('rejects add mode when the final balance exceeds the maximum', async () => {
    getTestDb().prepare('UPDATE User SET points = ? WHERE id = ?').run(500000, 'u1');
    const res = await POST(makeRequest({
      emails: ['u1@test.com'],
      mode: 'add',
      amount: 1000000,
      reason: '超过余额上限',
    }) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.succeededCount).toBe(0);
    expect(json.failed[0].reason).toMatch(/目标积分|余额超出上限/);
    expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('u1')).toEqual({ points: 500000 });
  });

  it('returns 400 for empty emails', async () => {
    const res = await POST(makeRequest({ emails: [], mode: 'add', amount: 10, reason: '空' }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing reason', async () => {
    const res = await POST(makeRequest({ emails: ['u1@test.com'], mode: 'add', amount: 10 }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-positive amount', async () => {
    const res = await POST(makeRequest({ emails: ['u1@test.com'], mode: 'add', amount: 0, reason: '零' }) as NextRequest);
    expect(res.status).toBe(400);
  });
});
