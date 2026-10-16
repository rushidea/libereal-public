import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));
vi.mock('@/lib/admin-mfa-settings', () => ({
  isAdminMfaScenarioEnabled: vi.fn(async () => false),
  requiresAdminMfaForPermission: vi.fn(async () => false),
}));

import { PATCH as orderPATCH } from '@/app/api/admin/orders/[id]/route';
import { POST as pointsRefundPOST } from '@/app/api/admin/orders/[id]/points-refund/route';
import { PATCH as redemptionPATCH } from '@/app/api/admin/points/redemptions/[id]/route';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

function refundRequest(yuan: number) {
  return new NextRequest('http://localhost:3000/api/admin/orders/o1/points-refund', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refundYuan: yuan, reason: '部分退款' }),
  });
}

function seedPointsOrder(points: { personal?: number; group?: number; applied?: number } = {}) {
  const db = getTestDb();
  db.prepare(`
    INSERT INTO "Order" (
      id, email, customerId, subtotal, total, pointsDiscount, pointsPersonal, pointsGroup,
      pointsApplied, status, shippingMethod, operationLogs, createdAt, updatedAt
    ) VALUES (
      'o1', 'buyer@test.com', 'u1', 100, 90, 10, ?, ?, ?, 'confirmed', 'logistics', '[]', datetime('now'), datetime('now')
    )
  `).run(points.personal ?? 10, points.group ?? 0, points.applied ?? 1);
}

describe('order points refunds', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'u1', email: 'buyer@test.com', points: 90 });
    seedPointsOrder();
  });

  it('returns the remaining points on the second partial refund and rejects cash past the payable amount', async () => {
    const db = getTestDb();
    const oversized = await pointsRefundPOST(refundRequest(150), { params: Promise.resolve({ id: 'o1' }) });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toEqual({ error: '退款金额不能超过原应付金额' });

    const first = await pointsRefundPOST(refundRequest(50), { params: Promise.resolve({ id: 'o1' }) });
    const tooMuch = await pointsRefundPOST(refundRequest(60), { params: Promise.resolve({ id: 'o1' }) });
    const second = await pointsRefundPOST(refundRequest(50), { params: Promise.resolve({ id: 'o1' }) });

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ personal: 5, group: 0 });
    expect(tooMuch.status).toBe(400);
    await expect(tooMuch.json()).resolves.toEqual({ error: '退款金额超过剩余可退金额' });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ personal: 5, group: 0 });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('u1')).toEqual({ points: 100 });
    expect(db.prepare('SELECT pointsRefundedPersonal, pointsRefundedCash FROM "Order" WHERE id = ?').get('o1')).toEqual({
      pointsRefundedPersonal: 10,
      pointsRefundedCash: 100,
    });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM PointsLog WHERE type = 'order_redeem_refund'`).get()).toEqual({ count: 2 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM AuditLog WHERE action = 'order.points_refund'`).get()).toEqual({ count: 2 });
  });

  it('rolls the cancellation back when points cannot be returned', async () => {
    const db = getTestDb();
    db.prepare(`UPDATE "Order" SET pointsPersonal = 0, pointsGroup = 8, pointsGroupId = NULL WHERE id = 'o1'`).run();

    const response = await orderPATCH(new NextRequest('http://localhost:3000/api/admin/orders/o1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    }), { params: Promise.resolve({ id: 'o1' }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'POINTS_REFUND_FAILED' });
    expect(db.prepare('SELECT status FROM "Order" WHERE id = ?').get('o1')).toEqual({ status: 'confirmed' });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('u1')).toEqual({ points: 90 });
  });

  it('returns every remaining point once when an order is cancelled after a partial refund', async () => {
    const db = getTestDb();
    const partial = await pointsRefundPOST(refundRequest(50), { params: Promise.resolve({ id: 'o1' }) });
    expect(partial.status).toBe(200);

    const response = await orderPATCH(new NextRequest('http://localhost:3000/api/admin/orders/o1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    }), { params: Promise.resolve({ id: 'o1' }) });

    expect(response.status).toBe(200);
    expect(db.prepare('SELECT status, pointsRefundedPersonal, pointsRefundedCash FROM "Order" WHERE id = ?').get('o1')).toEqual({
      status: 'cancelled',
      pointsRefundedPersonal: 10,
      pointsRefundedCash: 100,
    });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('u1')).toEqual({ points: 100 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM PointsLog WHERE type = 'order_redeem_refund'`).get()).toEqual({ count: 2 });
  });
});

describe('points redemption cancellation', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'u1', email: 'buyer@test.com', points: 800 });
    db.prepare(`
      INSERT INTO PointsProduct (id, name, pointsCost, stock, category, isActive, createdAt, updatedAt)
      VALUES ('p1', '试纸', 200, 4, 'virtual', 1, datetime('now'), datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO PointsRedemption (
        id, userId, productId, productName, pointsCost, status, createdAt, updatedAt
      ) VALUES ('r1', 'u1', 'p1', '试纸', 200, 'pending', datetime('now'), datetime('now'))
    `).run();
  });

  async function patch(body: object) {
    return redemptionPATCH(new NextRequest('http://localhost:3000/api/admin/points/redemptions/r1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: 'r1' }) });
  }

  it('returns points and restores stock once when a redemption is cancelled', async () => {
    const db = getTestDb();
    const first = await patch({ status: 'cancelled' });
    const second = await patch({ status: 'cancelled', trackingNumber: 'SF1' });
    const revert = await patch({ status: 'pending' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(revert.status).toBe(409);
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('u1')).toEqual({ points: 1000 });
    expect(db.prepare('SELECT stock FROM PointsProduct WHERE id = ?').get('p1')).toEqual({ stock: 5 });
    expect(db.prepare('SELECT status, pointsReturned, trackingNumber FROM PointsRedemption WHERE id = ?').get('r1')).toEqual({
      status: 'cancelled',
      pointsReturned: 1,
      trackingNumber: 'SF1',
    });
    expect(db.prepare(`SELECT delta, type FROM PointsLog WHERE relatedId = 'r1'`).all()).toEqual([
      { delta: 200, type: 'redemption_refund' },
    ]);
    expect(db.prepare(`SELECT COUNT(*) AS count FROM Notification WHERE type = 'points_redemption_refund'`).get()).toEqual({ count: 1 });
  });

  it('does not turn unlimited stock into a finite count', async () => {
    const db = getTestDb();
    db.prepare(`UPDATE PointsProduct SET stock = -1 WHERE id = 'p1'`).run();

    const response = await patch({ status: 'cancelled' });

    expect(response.status).toBe(200);
    expect(db.prepare('SELECT stock FROM PointsProduct WHERE id = ?').get('p1')).toEqual({ stock: -1 });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('u1')).toEqual({ points: 1000 });
  });

  it('repairs a cancelled redemption that never returned points, and only once', async () => {
    const db = getTestDb();
    db.prepare(`UPDATE PointsRedemption SET status = 'cancelled', pointsReturned = 0 WHERE id = 'r1'`).run();

    const first = await patch({ status: 'cancelled' });
    const second = await patch({ status: 'cancelled' });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('u1')).toEqual({ points: 1000 });
    expect(db.prepare('SELECT stock FROM PointsProduct WHERE id = ?').get('p1')).toEqual({ stock: 5 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM PointsLog WHERE type = 'redemption_refund'`).get()).toEqual({ count: 1 });
  });
});
