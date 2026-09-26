import { describe, it, expect, beforeAll, beforeEach, vi, afterAll } from 'vitest';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin' },
  }),
}));
vi.mock('@/lib/session', () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { POST } from '@/app/api/admin/points/undo/route';
import { NextRequest } from 'next/server';
import { getTestDb, closeTestDb, seedUser, seedAdmin } from './db-helpers';

describe('POST /api/admin/points/undo', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    db.exec('DELETE FROM PointsLog');
    db.exec('DELETE FROM AuditLog');
    db.exec('DELETE FROM User');
    seedAdmin(db);
    seedUser(db, { id: 'user_1', email: 'u1@test.com', points: 100, tier: 'tier-2' });
    // 创建一条历史 admin_adjust 日志
    db.prepare(`
      INSERT INTO PointsLog (id, userId, delta, type, reason, adminEmail, createdAt)
      VALUES ('log_1', 'user_1', 50, 'admin_adjust', '原加 50', 'old_admin@test.com', datetime('now'))
    `).run();
  });

  function makeRequest(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/points/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('reverses admin_adjust: subtracts 50 and adds new admin_undo log', async () => {
    const res = await POST(makeRequest({ logId: 'log_1' }) as NextRequest);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.newPoints).toBe(50); // 100 - 50

    const db = getTestDb();
    const user = db.prepare('SELECT points, tier FROM User WHERE id = ?').get('user_1') as { points: number; tier: string };
    expect(user.points).toBe(50);
    expect(user.tier).toBe('tier-2'); // 1 ≤ 50 < 101 = tier-2

    // 应该有 2 条日志：原 + 撤销
    const logs = db.prepare('SELECT * FROM PointsLog WHERE userId = ? ORDER BY createdAt').all('user_1') as Array<{ delta: number; type: string; adminEmail: string }>;
    expect(logs).toHaveLength(2);
    expect(logs[0].type).toBe('admin_adjust');
    expect(logs[0].delta).toBe(50);
    expect(logs[1].type).toBe('admin_undo');
    expect(logs[1].delta).toBe(-50);
    expect(logs[1].adminEmail).toBe('admin@test.com');
  });

  it('rejects a second undo for the same adjustment', async () => {
    const first = await POST(makeRequest({ logId: 'log_1' }) as NextRequest);
    expect(first.status).toBe(200);

    const second = await POST(makeRequest({ logId: 'log_1' }) as NextRequest);
    expect(second.status).toBe(409);
    expect((await second.json()).error).toMatch(/已经撤销/);

    const logs = getTestDb().prepare('SELECT type, undoOfId FROM PointsLog WHERE userId = ? ORDER BY createdAt').all('user_1') as Array<{ type: string; undoOfId: string | null }>;
    expect(logs).toHaveLength(2);
    expect(logs[1]).toEqual({ type: 'admin_undo', undoOfId: 'log_1' });
    expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('user_1')).toEqual({ points: 50 });
  });

  it('recognizes legacy relatedId-only undo records', async () => {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO PointsLog (id, userId, delta, type, reason, relatedId, adminEmail, createdAt)
      VALUES ('legacy_undo', 'user_1', -50, 'admin_undo', '旧版撤销', 'log_1', 'old_admin@test.com', datetime('now'))
    `).run();
    db.prepare('UPDATE User SET points = 50 WHERE id = ?').run('user_1');

    const res = await POST(makeRequest({ logId: 'log_1' }) as NextRequest);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/已经撤销/);
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM PointsLog WHERE type = ?').get('admin_undo')).toEqual({ count: 1 });
    expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('user_1')).toEqual({ points: 50 });
  });

  it('reverses negative adjust: adds points back', async () => {
    // 重设：用户 100，原日志 -50（扣了 50），撤销 = +50 回 100
    const db = getTestDb();
    db.prepare('UPDATE PointsLog SET delta = -50, reason = ? WHERE id = ?').run('原扣 50', 'log_1');
    db.prepare('UPDATE User SET points = 50 WHERE id = ?').run('user_1');

    const res = await POST(makeRequest({ logId: 'log_1' }) as NextRequest);
    const json = await res.json();
    expect(json.newPoints).toBe(100);
  });

  it('returns 400 for missing logId', async () => {
    const res = await POST(makeRequest({}) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent logId', async () => {
    const res = await POST(makeRequest({ logId: 'no_such_log' }) as NextRequest);
    expect(res.status).toBe(404);
  });

  it('rejects non-admin_adjust log types', async () => {
    const db = getTestDb();
    db.prepare(`UPDATE PointsLog SET type = 'order_credit' WHERE id = ?`).run('log_1');

    const res = await POST(makeRequest({ logId: 'log_1' }) as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/admin_adjust|管理员调整/);
  });

  it('refuses if resulting balance would be negative', async () => {
    // 用户 30 积分，原日志 +100（虚假情况），撤销后 = -70 应拒绝
    const db = getTestDb();
    db.prepare('UPDATE PointsLog SET delta = 100 WHERE id = ?').run('log_1');
    db.prepare('UPDATE User SET points = 30 WHERE id = ?').run('user_1');

    const res = await POST(makeRequest({ logId: 'log_1' }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('refuses an undo that would exceed the balance cap', async () => {
    const db = getTestDb();
    db.prepare('UPDATE User SET points = ? WHERE id = ?').run(1_000_000, 'user_1');
    db.prepare('UPDATE PointsLog SET delta = ? WHERE id = ?').run(-50, 'log_1');

    const res = await POST(makeRequest({ logId: 'log_1' }) as NextRequest);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/不能超过|上限/);
    const user = db.prepare('SELECT points FROM User WHERE id = ?').get('user_1') as { points: number };
    expect(user.points).toBe(1_000_000);
  });
});
