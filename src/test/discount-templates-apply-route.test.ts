import { describe, it, expect, beforeAll, beforeEach, vi, afterAll } from 'vitest';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { POST } from '@/app/api/admin/discount-templates/apply/route';
import { NextRequest } from 'next/server';
import { getTestDb, closeTestDb, seedUser, seedAdmin } from './db-helpers';

describe('POST /api/admin/discount-templates/apply', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    db.exec('DELETE FROM PointsLog');
    db.exec('DELETE FROM User');
    db.exec('DELETE FROM DiscountTemplate');
    db.exec('DELETE FROM Product');
    seedAdmin(db);
    seedUser(db, { id: 'user_1', email: 'u1@test.com' });
    seedUser(db, { id: 'user_2', email: 'u2@test.com' });
    seedUser(db, { id: 'user_3', email: 'u3@test.com' });
    db.prepare(`
      INSERT INTO Product (id, catalogNumber, name, brand, price, createdAt, updatedAt)
      VALUES ('discount-brand-product', 'DISC-001', '折扣测试产品', 'Abcam', 100, datetime('now'), datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO DiscountTemplate (id, name, discountRate, brandDiscounts, description, createdAt, updatedAt)
      VALUES ('tpl_1', 'VIP 模板', 0.8, '{"Abcam": 0.7}', '8 折统一 + Abcam 7 折', datetime('now'), datetime('now'))
    `).run();
  });

  function makeRequest(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/discount-templates/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('applies template to multiple users: sets discountRate + brandDiscounts + sourceTemplateId', async () => {
    const res = await POST(makeRequest({ templateId: 'tpl_1', userIds: ['user_1', 'user_2'] }) as NextRequest);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.appliedCount).toBe(2);

    const db = getTestDb();
    const users = db.prepare('SELECT id, discountRate, brandDiscounts, sourceTemplateId FROM User WHERE id IN (?, ?)').all('user_1', 'user_2') as Array<{ id: string; discountRate: number; brandDiscounts: string; sourceTemplateId: string }>;
    expect(users).toHaveLength(2);
    for (const u of users) {
      expect(u.discountRate).toBe(0.8);
      expect(u.brandDiscounts).toBe('{"Abcam":0.7}');
      expect(u.sourceTemplateId).toBe('tpl_1');
    }
    // user_3 不应该被改
    const u3 = db.prepare('SELECT discountRate, brandDiscounts, sourceTemplateId FROM User WHERE id = ?').get('user_3') as { discountRate: number | null; brandDiscounts: string | null; sourceTemplateId: string | null };
    expect(u3.discountRate).toBeNull();
    expect(u3.brandDiscounts).toBeNull();
    expect(u3.sourceTemplateId).toBeNull();
  });

  it('overwrites previous template source when applying new template', async () => {
    // 第一次：套 tpl_1
    await POST(makeRequest({ templateId: 'tpl_1', userIds: ['user_1'] }) as NextRequest);

    // 创建 tpl_2 + 套用
    const db = getTestDb();
    db.prepare(`
      INSERT INTO DiscountTemplate (id, name, discountRate, brandDiscounts, createdAt, updatedAt)
      VALUES ('tpl_2', 'Premium', 0.7, null, datetime('now'), datetime('now'))
    `).run();

    const res = await POST(makeRequest({ templateId: 'tpl_2', userIds: ['user_1'] }) as NextRequest);
    expect(res.status).toBe(200);

    const u1 = db.prepare('SELECT discountRate, sourceTemplateId FROM User WHERE id = ?').get('user_1') as { discountRate: number; sourceTemplateId: string };
    expect(u1.discountRate).toBe(0.7);
    expect(u1.sourceTemplateId).toBe('tpl_2');
  });

  it('overwrites user pre-existing discountRate/brandDiscounts', async () => {
    const db = getTestDb();
    db.prepare('UPDATE User SET discountRate = 0.95, brandDiscounts = ? WHERE id = ?').run('{"Abcam": 0.95}', 'user_1');

    const res = await POST(makeRequest({ templateId: 'tpl_1', userIds: ['user_1'] }) as NextRequest);
    expect(res.status).toBe(200);

    const u1 = db.prepare('SELECT discountRate, brandDiscounts FROM User WHERE id = ?').get('user_1') as { discountRate: number; brandDiscounts: string };
    expect(u1.discountRate).toBe(0.8);
    expect(u1.brandDiscounts).toBe('{"Abcam":0.7}');
  });

  it('returns 400 for missing templateId', async () => {
    const res = await POST(makeRequest({ userIds: ['user_1'] }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty userIds', async () => {
    const res = await POST(makeRequest({ templateId: 'tpl_1', userIds: [] }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent template', async () => {
    const res = await POST(makeRequest({ templateId: 'no_such_tpl', userIds: ['user_1'] }) as NextRequest);
    expect(res.status).toBe(404);
  });
});
