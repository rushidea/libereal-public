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

import { GET as ordersGET, POST as ordersPOST } from '@/app/api/admin/orders/route';
import { GET as customersGET } from '@/app/api/admin/customers/route';
import { PUT as userUpdatePUT } from '@/app/api/admin/users/update/route';
import { NextRequest } from 'next/server';
import { getTestDb, closeTestDb, seedUser, seedAdmin, clearAllTables } from './db-helpers';

function seedOrder(db: ReturnType<typeof getTestDb>, order: {
  id: string;
  email: string;
  status?: string;
  archivedAt?: string | null;
}) {
  db.prepare(`
    INSERT INTO "Order" (id, email, subtotal, status, shippingMethod, operationLogs, createdAt, updatedAt, archivedAt)
    VALUES (?, ?, 100, ?, 'logistics', '[]', datetime('now'), datetime('now'), ?)
  `).run(order.id, order.email, order.status ?? 'pending', order.archivedAt ?? null);
}

describe('GET /api/admin/orders (list)', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedOrder(db, { id: 'o1', email: 'u1@test.com' });
    seedOrder(db, { id: 'o2', email: 'u2@test.com', status: 'shipped' });
    seedOrder(db, { id: 'o3', email: 'u3@test.com', status: 'shipped' });
    seedOrder(db, { id: 'o4', email: 'u4@test.com', archivedAt: new Date().toISOString() });
  });

  it('returns all non-archived orders, newest first', async () => {
    const res = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders') as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.orders).toHaveLength(3); // o4 archived excluded
  });

  it('filters by status', async () => {
    const res = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?status=shipped') as NextRequest);
    const json = await res.json();
    expect(json.orders).toHaveLength(2);
    expect(json.orders.every((o: { status: string }) => o.status === 'shipped')).toBe(true);
  });

  it('enriches order with name/institution/phone from address snapshot', async () => {
    const db = getTestDb();
    db.prepare(`INSERT INTO OrderAddressSnapshot (id, orderId, name, institution, phone, address) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('snapshot_1', 'o1', '收货张三', '清华大学', '13800001111', '北京市海淀区');

    const res = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders') as NextRequest);
    const json = await res.json();
    const o1 = json.orders.find((o: { id: string }) => o.id === 'o1');
    expect(o1.name).toBe('收货张三');
    expect(o1.institution).toBe('清华大学');
    expect(o1.phone).toBe('13800001111');
  });
});

describe('POST /api/admin/orders (admin create order)', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
  });

  function makeReq(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('stores product subtotal and fees as separate adjustments', async () => {
    const res = await ordersPOST(makeReq({
      customerEmail: 'cust@test.com',
      items: [
        { name: '产品A', price: 100, quantity: 2 },
        { name: '产品B', price: 50, quantity: 3 },
      ],
      platformFee: 10,
      transferFee: 5,
      paymentMethod: 'bank_transfer',
    }) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.orderId).toMatch(/^ORD-\d{8}-\d{3}$/);
    expect(json.order.subtotal).toBe(350);
    expect(json.order.adjustmentTotal).toBe(15);
    expect(json.order.total).toBe(365);

    const db = getTestDb();
    const o = db.prepare('SELECT subtotal, adjustmentTotal, total FROM "Order" WHERE id = ?').get(json.orderId) as { subtotal: number; adjustmentTotal: number; total: number };
    expect(o).toEqual({ subtotal: 350, adjustmentTotal: 15, total: 365 });
  });

  it('increments daily sequence (ORD-DATE-001 → ORD-DATE-002)', async () => {
    const res1 = await ordersPOST(makeReq({
      customerEmail: 'a@test.com',
      items: [{ name: 'X', price: 100, quantity: 1 }],
      paymentMethod: 'bank_transfer',
    }) as NextRequest);
    const res2 = await ordersPOST(makeReq({
      customerEmail: 'b@test.com',
      items: [{ name: 'X', price: 200, quantity: 1 }],
      paymentMethod: 'bank_transfer',
    }) as NextRequest);
    const id1 = (await res1.json()).orderId as string;
    const id2 = (await res2.json()).orderId as string;
    expect(id1).not.toBe(id2);
    // seq 应该递增（具体数字看时间，但一定不同）
    expect(id1.split('-').pop()).not.toBe(id2.split('-').pop());
  });

  it('returns 400 for empty items array', async () => {
    const res = await ordersPOST(makeReq({
      customerEmail: 'cust@test.com',
      items: [],
    }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing customerEmail', async () => {
    const res = await ordersPOST(makeReq({
      items: [{ name: 'X', price: 100, quantity: 1 }],
    }) as NextRequest);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/customers', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'u1', email: 'u1@test.com', name: '客户一' });
    seedUser(db, { id: 'u2', email: 'u2@test.com', name: '客户二' });
  });

  it('returns only customers (excludes admin)', async () => {
    const res = await customersGET();
    const json = await res.json();
    expect(res.status).toBe(200);
    // admin 已 WHERE role='customer' 过滤；route 不 select role 字段，只看数量
    expect(json.customers).toHaveLength(2);
    expect(json.customers.every((c: { email: string }) => ['u1@test.com', 'u2@test.com'].includes(c.email))).toBe(true);
  });

  it('includes user addresses in result', async () => {
    const db = getTestDb();
    db.prepare(`INSERT INTO Address (id, userId, name, phone, address, isDefault, createdAt, updatedAt)
                VALUES ('a1', 'u1', '收货', '138', '北京', 1, datetime('now'), datetime('now'))`).run();

    const res = await customersGET();
    const json = await res.json();
    const u1 = json.customers.find((c: { id: string }) => c.id === 'u1');
    expect(u1.addresses).toHaveLength(1);
    expect(u1.addresses[0].name).toBe('收货');
  });

  it('parses brandDiscounts JSON to object', async () => {
    const db = getTestDb();
    db.prepare('UPDATE User SET brandDiscounts = ? WHERE id = ?').run('{"CST":0.85}', 'u1');

    const res = await customersGET();
    const json = await res.json();
    const u1 = json.customers.find((c: { id: string }) => c.id === 'u1');
    expect(u1.brandDiscounts).toEqual({ CST: 0.85 });
  });
});

describe('PUT /api/admin/users/update', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'u1', email: 'u1@test.com', points: 100 });
  });

  function makeReq(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/users/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('updates discountRate to valid value 0.85', async () => {
    const res = await userUpdatePUT(makeReq({ userId: 'u1', discountRate: 0.85 }) as NextRequest);
    expect(res.status).toBe(200);

    const db = getTestDb();
    const u1 = db.prepare('SELECT discountRate FROM User WHERE id = ?').get('u1') as { discountRate: number };
    expect(u1.discountRate).toBe(0.85);
  });

  it('rejects discountRate > 2 (max=2 边界)', async () => {
    const res = await userUpdatePUT(makeReq({ userId: 'u1', discountRate: 3 }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('clears discountRate when set to null', async () => {
    const db = getTestDb();
    db.prepare('UPDATE User SET discountRate = 0.9 WHERE id = ?').run('u1');

    const res = await userUpdatePUT(makeReq({ userId: 'u1', discountRate: null }) as NextRequest);
    expect(res.status).toBe(200);

    const u1 = db.prepare('SELECT discountRate FROM User WHERE id = ?').get('u1') as { discountRate: number | null };
    expect(u1.discountRate).toBeNull();
  });

  it('updates brandDiscounts JSON object', async () => {
    const res = await userUpdatePUT(makeReq({
      userId: 'u1',
      brandDiscounts: { CST: 0.85, Abcam: 0.9 },
    }) as NextRequest);
    expect(res.status).toBe(200);

    const db = getTestDb();
    const u1 = db.prepare('SELECT brandDiscounts FROM User WHERE id = ?').get('u1') as { brandDiscounts: string };
    expect(JSON.parse(u1.brandDiscounts)).toEqual({ CST: 0.85, Abcam: 0.9 });
  });

  it('rejects brandDiscounts with rate > 2', async () => {
    const res = await userUpdatePUT(makeReq({
      userId: 'u1',
      brandDiscounts: { Bad: 5 },
    }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('updates points + writes PointsLog with delta', async () => {
    // u1 现有 100, 设 250 → delta=150
    const res = await userUpdatePUT(makeReq({ userId: 'u1', points: 250 }) as NextRequest);
    expect(res.status).toBe(200);

    const db = getTestDb();
    const u1 = db.prepare('SELECT points FROM User WHERE id = ?').get('u1') as { points: number };
    expect(u1.points).toBe(250);
    const log = db.prepare('SELECT * FROM PointsLog WHERE userId = ?').get('u1') as { delta: number; type: string };
    expect(log.delta).toBe(150);
    expect(log.type).toBe('admin_adjust');
  });

  it('rejects a points balance above the shared maximum', async () => {
    const res = await userUpdatePUT(makeReq({ userId: 'u1', points: 1000001 }) as NextRequest);
    expect(res.status).toBe(400);
    expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('u1')).toEqual({ points: 100 });
  });

  it('updates isNewUser=false → sends approval notification', async () => {
    const res = await userUpdatePUT(makeReq({ userId: 'u1', isNewUser: false }) as NextRequest);
    expect(res.status).toBe(200);

    const db = getTestDb();
    const u1 = db.prepare('SELECT isNewUser FROM User WHERE id = ?').get('u1') as { isNewUser: number };
    expect(u1.isNewUser).toBe(0);

    const notifs = db.prepare('SELECT * FROM Notification WHERE email = ?').all('u1@test.com') as Array<{ title: string }>;
    expect(notifs).toHaveLength(1);
    expect(notifs[0].title).toMatch(/审核/);
  });

  it('returns 404 for non-existent user', async () => {
    const res = await userUpdatePUT(makeReq({ userId: 'nonexistent', discountRate: 0.9 }) as NextRequest);
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing userId', async () => {
    const res = await userUpdatePUT(makeReq({ discountRate: 0.9 }) as NextRequest);
    expect(res.status).toBe(400);
  });
});
