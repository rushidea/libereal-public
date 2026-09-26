import { describe, it, expect, beforeAll, beforeEach, vi, afterAll } from 'vitest';

// vi.mock 会被 hoist 到顶部，factory 内不能引用外部 const
// 用 importActual 或 inline vi.fn() 是安全的
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  auth: authMock,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { POST } from '@/app/api/points/redeem/route';
import { NextRequest } from 'next/server';
import Database from 'better-sqlite3';
import { getTestDb, closeTestDb, seedUser } from './db-helpers';

function setSession(userId: string, email: string) {
  authMock.mockResolvedValue({ user: { id: userId, email, name: 'Test', role: 'customer' } });
}

function makeRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/points/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function seedProduct(db: Database.Database, product: {
  id: string;
  name: string;
  pointsCost: number;
  stock: number;
  category?: string;
  metadata?: string | null;
  isActive?: number;
}) {
  db.prepare(`
    INSERT INTO PointsProduct (id, name, pointsCost, stock, category, metadata, isActive, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    product.id,
    product.name,
    product.pointsCost,
    product.stock,
    product.category ?? 'virtual',
    product.metadata ?? null,
    product.isActive ?? 1,
  );
}

describe('POST /api/points/redeem', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    db.exec('DELETE FROM Notification');
    db.exec('DELETE FROM PointsRedemption');
    db.exec('DELETE FROM PointsLog');
    db.exec('DELETE FROM PointsProduct');
    db.exec('DELETE FROM User');
    setSession('u1', 'u1@test.com');
    seedUser(db, { id: 'u1', email: 'u1@test.com', points: 1000, tier: 'tier-2' });
  });

  it('redeems virtual product: subtracts points + creates redemption + log + notification', async () => {
    const db = getTestDb();
    seedProduct(db, { id: 'p1', name: '基因试纸', pointsCost: 200, stock: 10, category: 'virtual' });

    const res = await POST(makeRequest({ productId: 'p1' }) as NextRequest);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.newPoints).toBe(800);
    expect(json.newTier).toBeUndefined();

    const u1 = db.prepare('SELECT points FROM User WHERE id = ?').get('u1') as { points: number };
    expect(u1.points).toBe(800);
    const p1 = db.prepare('SELECT stock FROM PointsProduct WHERE id = ?').get('p1') as { stock: number };
    expect(p1.stock).toBe(9);

    const redemptions = db.prepare('SELECT * FROM PointsRedemption').all() as Array<{ productId: string; pointsCost: number; status: string }>;
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0].productId).toBe('p1');
    expect(redemptions[0].pointsCost).toBe(200);
    expect(redemptions[0].status).toBe('pending');

    const logs = db.prepare('SELECT * FROM PointsLog').all() as Array<{ delta: number; type: string }>;
    expect(logs).toHaveLength(1);
    expect(logs[0].delta).toBe(-200);
    expect(logs[0].type).toBe('redemption');

    const notifs = db.prepare('SELECT * FROM Notification').all() as Array<{ email: string; type: string }>;
    expect(notifs).toHaveLength(1);
    expect(notifs[0].email).toBe('u1@test.com');
    expect(notifs[0].type).toBe('points_redemption');
  });

  it('keeps membership tier independent from redemption balance', async () => {
    const db = getTestDb();
    // u1 1000 points, cost 900 → 100 points remaining → still tier-2
    // need 101 to upgrade to tier-3, so: u1 200 → cost 50 → 150 → tier-3
    db.prepare('UPDATE User SET points = ? WHERE id = ?').run(200, 'u1');
    seedProduct(db, { id: 'p1', name: '小礼品', pointsCost: 50, stock: 5 });

    const res = await POST(makeRequest({ productId: 'p1' }) as NextRequest);
    const json = await res.json();
    expect(json.newPoints).toBe(150);
    expect(json.newTier).toBeUndefined();

    const u1 = db.prepare('SELECT tier FROM User WHERE id = ?').get('u1') as { tier: string };
    expect(u1.tier).toBe('tier-2');
  });

  it('handles variant selection (3 spec, pick middle)', async () => {
    const db = getTestDb();
    seedProduct(db, {
      id: 'p1',
      name: '盲盒',
      pointsCost: 100, // base (not used when variant selected)
      stock: 10,
      category: 'virtual',
      metadata: JSON.stringify({
        variants: [
          { name: 'A 小', cost: 50 },
          { name: 'B 中', cost: 100 },
          { name: 'C 大', cost: 200 },
        ],
      }),
    });

    const res = await POST(makeRequest({ productId: 'p1', variantIndex: 1 }) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.newPoints).toBe(900); // 1000 - 100

    const redemptions = db.prepare('SELECT variantName, pointsCost FROM PointsRedemption').all() as Array<{ variantName: string; pointsCost: number }>;
    expect(redemptions[0].variantName).toBe('B 中');
    expect(redemptions[0].pointsCost).toBe(100);
  });

  it('returns 400 if variant required but not provided', async () => {
    const db = getTestDb();
    seedProduct(db, {
      id: 'p1',
      name: '多规格',
      pointsCost: 100,
      stock: 10,
      metadata: JSON.stringify({ variants: [{ name: 'A', cost: 50 }] }),
    });

    const res = await POST(makeRequest({ productId: 'p1' }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('physical product: requires shippingInfo (name/phone/address)', async () => {
    const db = getTestDb();
    seedProduct(db, { id: 'p1', name: '实物', pointsCost: 100, stock: 5, category: 'physical' });

    const res = await POST(makeRequest({ productId: 'p1' }) as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/收货/);
  });

  it('physical product: with shippingInfo succeeds', async () => {
    const db = getTestDb();
    seedProduct(db, { id: 'p1', name: '实物', pointsCost: 100, stock: 5, category: 'physical' });

    const res = await POST(makeRequest({
      productId: 'p1',
      shippingInfo: { name: '张三', phone: '13800001111', address: '北京市海淀区' },
    }) as NextRequest);
    expect(res.status).toBe(200);

    const redemptions = db.prepare('SELECT shippingInfo FROM PointsRedemption').all() as Array<{ shippingInfo: string }>;
    expect(JSON.parse(redemptions[0].shippingInfo)).toEqual({ name: '张三', phone: '13800001111', address: '北京市海淀区' });
  });

  it('returns 400 if user has insufficient points', async () => {
    const db = getTestDb();
    db.prepare('UPDATE User SET points = 50 WHERE id = ?').run('u1');
    seedProduct(db, { id: 'p1', name: '贵', pointsCost: 100, stock: 5 });

    const res = await POST(makeRequest({ productId: 'p1' }) as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/积分不足/);
  });

  it('returns 400 if product is out of stock (stock > 0 check)', async () => {
    const db = getTestDb();
    seedProduct(db, { id: 'p1', name: '无库存', pointsCost: 100, stock: 0 });

    const res = await POST(makeRequest({ productId: 'p1' }) as NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/库存/);
  });

  it('unlimited stock (stock = -1) never runs out', async () => {
    const db = getTestDb();
    seedProduct(db, { id: 'p1', name: '无限', pointsCost: 100, stock: -1 });

    const res = await POST(makeRequest({ productId: 'p1' }) as NextRequest);
    expect(res.status).toBe(200);
    const p1 = db.prepare('SELECT stock FROM PointsProduct WHERE id = ?').get('p1') as { stock: number };
    expect(p1.stock).toBe(-1);
  });

  it('returns 400 for inactive product', async () => {
    const db = getTestDb();
    seedProduct(db, { id: 'p1', name: '下架', pointsCost: 100, stock: 5, isActive: 0 });

    const res = await POST(makeRequest({ productId: 'p1' }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent product', async () => {
    const res = await POST(makeRequest({ productId: 'nonexistent' }) as NextRequest);
    expect(res.status).toBe(404);
  });

  it('returns 401 when not logged in', async () => {
    authMock.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ productId: 'p1' }) as NextRequest);
    expect(res.status).toBe(401);
  });
});
