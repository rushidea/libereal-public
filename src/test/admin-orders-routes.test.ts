import { describe, it, expect, beforeAll, beforeEach, vi, afterAll } from 'vitest';

const sessionMocks = vi.hoisted(() => ({ requireAdminStepUp: vi.fn() }));

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));
vi.mock('@/lib/admin-mfa-settings', () => ({
  isAdminMfaScenarioEnabled: vi.fn(async () => false),
  requiresAdminMfaForPermission: vi.fn(async () => false),
}));
vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session')>()),
  requireAdminStepUp: sessionMocks.requireAdminStepUp,
}));

import { GET as orderGET, PATCH as orderPATCH } from '@/app/api/admin/orders/[id]/route';
import { POST as shipmentPOST } from '@/app/api/admin/orders/[id]/shipments/route';
import { POST as adjustmentPOST } from '@/app/api/admin/orders/[id]/adjustments/route';
import { POST as pointsRefundPOST } from '@/app/api/admin/orders/[id]/points-refund/route';
import { PATCH as archivePATCH } from '@/app/api/admin/orders/archive/route';
import { GET as archivedGET } from '@/app/api/admin/orders/archived/route';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminMfaScenarioEnabled, requiresAdminMfaForPermission } from '@/lib/admin-mfa-settings';
import { getTestDb, closeTestDb, seedAdmin, clearAllTables } from './db-helpers';

function seedOrder(db: ReturnType<typeof getTestDb>, order: {
  id: string;
  email: string;
  items?: string;
  subtotal?: number;
  status?: string;
  shippingMethod?: string;
  archivedAt?: string | null;
}) {
  db.prepare(`INSERT OR IGNORE INTO Product (id, catalogNumber, name, brand, price, stockQuantity, applications, reactivity, createdAt, updatedAt) VALUES ('p1', 'p1', '产品A', '测试品牌', 100, -1, '[]', '[]', datetime('now'), datetime('now'))`).run();
  db.prepare(`
    INSERT INTO "Order" (id, email, subtotal, total, status, shippingMethod, operationLogs, createdAt, updatedAt, archivedAt)
    VALUES (?, ?, ?, ?, ?, ?, '[]', datetime('now'), datetime('now'), ?)
  `).run(
    order.id,
    order.email,
    order.subtotal ?? 200,
    order.subtotal ?? 200,
    order.status ?? 'pending',
    order.shippingMethod ?? 'logistics',
    order.archivedAt ?? null,
  );
  const item = JSON.parse(order.items ?? JSON.stringify([{ productId: 'p1', name: '产品A', price: 100, quantity: 2 }]))[0];
  db.prepare(`
    INSERT INTO OrderItem (id, orderId, position, productId, name, unitPrice, quantity, shippedQty, status, createdAt, updatedAt)
    VALUES (?, ?, 0, ?, ?, ?, ?, 0, 'pending', datetime('now'), datetime('now'))
  `).run(`${order.id}_item_0`, order.id, item.productId ?? null, item.name, item.price, item.quantity);
}

describe('GET /api/admin/orders/[id]', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedOrder(db, { id: 'o1', email: 'u1@test.com' });
  });

  it('returns order by id', async () => {
    const res = await orderGET(new NextRequest('http://localhost:3000/api/admin/orders/o1') as NextRequest, {
      params: Promise.resolve({ id: 'o1' }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.order.id).toBe('o1');
    expect(json.order.email).toBe('u1@test.com');
    expect(json.order.items).toEqual([
      expect.objectContaining({ productId: 'p1', name: '产品A', price: 100, quantity: 2 }),
    ]);
  });

  it('returns 404 for non-existent order', async () => {
    const res = await orderGET(new NextRequest('http://localhost:3000/api/admin/orders/nonexistent') as NextRequest, {
      params: Promise.resolve({ id: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/orders/[id]', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedOrder(db, { id: 'o1', email: 'u1@test.com' });
  });

  function makePatch(id: string, body: object): NextRequest {
    return new NextRequest(`http://localhost:3000/api/admin/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rejects closing a paid Alipay order without refund', async () => {
    getTestDb().prepare(`UPDATE "Order" SET status = 'pending', paymentMethod = 'alipay', paidAt = datetime('now') WHERE id = 'o1'`).run();
    const res = await orderPATCH(makePatch('o1', { status: 'closed' }) as NextRequest, {
      params: Promise.resolve({ id: 'o1' }),
    });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'PAID_ORDER_REFUND_REQUIRED' });
    expect(getTestDb().prepare('SELECT status FROM "Order" WHERE id = ?').get('o1')).toEqual({ status: 'pending' });
  });

  it('updates status through an allowed transition', async () => {
    const res = await orderPATCH(makePatch('o1', { status: 'cancelled' }) as NextRequest, {
      params: Promise.resolve({ id: 'o1' }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.order.status).toBe('cancelled');

    const db = getTestDb();
    const o1 = db.prepare('SELECT status FROM "Order" WHERE id = ?').get('o1') as { status: string };
    expect(o1.status).toBe('cancelled');
    const history = db.prepare('SELECT fromStatus, toStatus FROM OrderStatusHistory WHERE orderId = ?')
      .all('o1') as Array<{ fromStatus: string; toStatus: string }>;
    expect(history).toEqual([{ fromStatus: 'pending', toStatus: 'cancelled' }]);
  });

  it('rejects an invalid status transition', async () => {
    const res = await orderPATCH(makePatch('o1', { status: 'shipped' }) as NextRequest, {
      params: Promise.resolve({ id: 'o1' }),
    });
    expect(res.status).toBe(409);
  });

  it('creates a shipment and updates shipped quantities', async () => {
    getTestDb().prepare(`UPDATE "Order" SET status = 'confirmed' WHERE id = 'o1'`).run();
    const req = new NextRequest('http://localhost:3000/api/admin/orders/o1/shipments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'logistics', carrier: '顺丰', trackingNumber: 'SF1234567890',
        items: [{ orderItemId: 'o1_item_0', quantity: 2 }],
      }),
    });
    const res = await shipmentPOST(req, {
      params: Promise.resolve({ id: 'o1' }),
    });
    const json = await res.json();
    expect(res.status).toBe(201);
    expect(json.orderStatus).toBe('shipped');
    expect(getTestDb().prepare('SELECT shippedQty FROM OrderItem WHERE id = ?').get('o1_item_0')).toEqual({ shippedQty: 2 });
  });

  it('rejects shipment quantities above the remaining quantity', async () => {
    getTestDb().prepare(`UPDATE "Order" SET status = 'confirmed' WHERE id = 'o1'`).run();
    const req = new NextRequest('http://localhost:3000/api/admin/orders/o1/shipments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'logistics', carrier: '顺丰', trackingNumber: 'SF1', items: [{ orderItemId: 'o1_item_0', quantity: 3 }] }),
    });
    const res = await shipmentPOST(req, { params: Promise.resolve({ id: 'o1' }) });
    expect(res.status).toBe(400);
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM Shipment').get()).toEqual({ count: 0 });
  });

  it('rejects a negative final total without saving the adjustment', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/orders/o1/adjustments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'discount', label: '测试折扣', amount: -201 }),
    });
    const res = await adjustmentPOST(req, { params: Promise.resolve({ id: 'o1' }) });
    expect(res.status).toBe(400);
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM OrderAdjustment').get()).toEqual({ count: 0 });
  });

  it('returns 404 for non-existent order', async () => {
    const res = await orderPATCH(makePatch('nonexistent', { status: 'shipped' }) as NextRequest, {
      params: Promise.resolve({ id: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });

  it('handles empty PATCH (no fields) gracefully', async () => {
    const res = await orderPATCH(makePatch('o1', {}) as NextRequest, {
      params: Promise.resolve({ id: 'o1' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/admin/orders/archive', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedOrder(db, { id: 'o1', email: 'u1@test.com' });
    seedOrder(db, { id: 'o2', email: 'u2@test.com' });
  });

  function makeReq(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/orders/archive', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('archives multiple orders (sets archivedAt)', async () => {
    const res = await archivePATCH(makeReq({ orderIds: ['o1', 'o2'], action: 'archive' }) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.count).toBe(2);

    const db = getTestDb();
    const orders = db.prepare('SELECT id, archivedAt FROM "Order" ORDER BY id').all() as Array<{ id: string; archivedAt: string | null }>;
    expect(orders[0].archivedAt).not.toBeNull();
    expect(orders[1].archivedAt).not.toBeNull();
  });

  it('unarchives orders (sets archivedAt to NULL)', async () => {
    // 先归档
    const db = getTestDb();
    db.prepare('UPDATE "Order" SET archivedAt = datetime(\'now\') WHERE id IN (?, ?)').run('o1', 'o2');

    const res = await archivePATCH(makeReq({ orderIds: ['o1'], action: 'unarchive' }) as NextRequest);
    expect(res.status).toBe(200);

    const o1 = db.prepare('SELECT archivedAt FROM "Order" WHERE id = ?').get('o1') as { archivedAt: string | null };
    expect(o1.archivedAt).toBeNull();
  });

  it('deletes orders', async () => {
    const res = await archivePATCH(makeReq({ orderIds: ['o1'], action: 'delete' }) as NextRequest);
    expect(res.status).toBe(200);

    const db = getTestDb();
    const remaining = db.prepare('SELECT id FROM "Order"').all() as Array<{ id: string }>;
    expect(remaining.map(o => o.id)).toEqual(['o2']);
  });

  it('returns 400 for empty orderIds', async () => {
    const res = await archivePATCH(makeReq({ orderIds: [], action: 'archive' }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid action', async () => {
    const res = await archivePATCH(makeReq({ orderIds: ['o1'], action: 'purge' }) as NextRequest);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/orders/archived', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedOrder(db, { id: 'o1', email: 'u1@test.com' });
    seedOrder(db, { id: 'o2', email: 'u2@test.com', archivedAt: new Date().toISOString() });
    seedOrder(db, { id: 'o3', email: 'u3@test.com', archivedAt: new Date(Date.now() - 86400000).toISOString() });
  });

  it('returns only archived orders, newest first', async () => {
    const res = await archivedGET(new NextRequest('http://localhost:3000/api/admin/orders/archived') as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.orders).toHaveLength(2);
    // o2 archived now, o3 archived 1 day ago → o2 first
    expect(json.orders[0].id).toBe('o2');
  });
});

describe('finance.write MFA scenario gating', () => {
  function makePatch(id: string, body: object): NextRequest {
    return new NextRequest(`http://localhost:3000/api/admin/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedOrder(db, { id: 'o1', email: 'u1@test.com' });
    vi.mocked(requiresAdminMfaForPermission).mockResolvedValue(false);
    vi.mocked(isAdminMfaScenarioEnabled).mockResolvedValue(false);
    sessionMocks.requireAdminStepUp.mockReset();
    sessionMocks.requireAdminStepUp.mockImplementation(async (user) => user);
  });

  it('requires admin step-up when cancelling an order with finance.write enabled', async () => {
    vi.mocked(isAdminMfaScenarioEnabled).mockImplementation(async (id) => id === 'finance.write');

    const res = await orderPATCH(makePatch('o1', { status: 'cancelled' }) as NextRequest, {
      params: Promise.resolve({ id: 'o1' }),
    });

    expect(sessionMocks.requireAdminStepUp).toHaveBeenCalledWith(expect.objectContaining({ id: 'admin_test_id' }));
    expect(res.status).toBe(200);
  });

  it('blocks cancellation when the finance step-up is rejected', async () => {
    vi.mocked(isAdminMfaScenarioEnabled).mockImplementation(async (id) => id === 'finance.write');
    sessionMocks.requireAdminStepUp.mockResolvedValue(
      NextResponse.json({ error: 'Admin MFA required' }, { status: 403 }),
    );

    const res = await orderPATCH(makePatch('o1', { status: 'cancelled' }) as NextRequest, {
      params: Promise.resolve({ id: 'o1' }),
    });

    expect(res.status).toBe(403);
    expect(getTestDb().prepare('SELECT status FROM "Order" WHERE id = ?').get('o1')).toEqual({ status: 'pending' });
  });

  it('skips finance step-up when finance.write is disabled', async () => {
    const res = await orderPATCH(makePatch('o1', { status: 'cancelled' }) as NextRequest, {
      params: Promise.resolve({ id: 'o1' }),
    });

    expect(sessionMocks.requireAdminStepUp).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('does not apply finance step-up to a confirming transition even when enabled', async () => {
    vi.mocked(isAdminMfaScenarioEnabled).mockImplementation(async (id) => id === 'finance.write');

    const res = await orderPATCH(makePatch('o1', { status: 'confirmed' }) as NextRequest, {
      params: Promise.resolve({ id: 'o1' }),
    });

    expect(sessionMocks.requireAdminStepUp).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('requires admin step-up for points refund with finance.write enabled', async () => {
    vi.mocked(isAdminMfaScenarioEnabled).mockImplementation(async (id) => id === 'finance.write');
    sessionMocks.requireAdminStepUp.mockResolvedValue(
      NextResponse.json({ error: 'Admin MFA required' }, { status: 403 }),
    );

    const req = new NextRequest('http://localhost:3000/api/admin/orders/o1/points-refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refundYuan: 100 }),
    });
    const res = await pointsRefundPOST(req, { params: Promise.resolve({ id: 'o1' }) });

    expect(sessionMocks.requireAdminStepUp).toHaveBeenCalled();
    expect(res.status).toBe(403);
  });

  it('skips finance step-up for points refund when disabled and keeps order validation', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/orders/o1/points-refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refundYuan: 100 }),
    });
    const res = await pointsRefundPOST(req, { params: Promise.resolve({ id: 'o1' }) });

    expect(sessionMocks.requireAdminStepUp).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
  });
});
