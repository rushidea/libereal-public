import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeStalePendingOrders, orderAutoCloseAt } from '@/lib/order-auto-close';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

function insertOrder(db: ReturnType<typeof getTestDb>, order: {
  id: string;
  status: string;
  paymentMethod?: string | null;
  paidAt?: string | null;
  autoCloseAt: string;
}) {
  db.prepare(`
    INSERT INTO "Order" (
      id, email, subtotal, total, status, paymentMethod, owner_scope, shippingMethod, operationLogs,
      createdAt, updatedAt, auto_close_at, paidAt
    ) VALUES (?, 'buyer@example.com', 100, 100, ?, ?, 'personal', 'logistics', '[]', datetime('now'), datetime('now'), ?, ?)
  `).run(order.id, order.status, order.paymentMethod ?? null, order.autoCloseAt, order.paidAt ?? null);
}

describe('orderAutoCloseAt', () => {
  it('uses the 24-hour Alipay payment window and 48 hours for other methods', () => {
    const from = new Date('2026-08-19T00:00:00.000Z');
    expect(orderAutoCloseAt('alipay', from).toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(orderAutoCloseAt('bank_transfer', from).toISOString()).toBe('2026-08-21T00:00:00.000Z');
  });
});

describe('closeStalePendingOrders', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    clearAllTables(getTestDb());
  });

  it('closes expired unpaid Alipay orders as closed', async () => {
    const db = getTestDb();
    insertOrder(db, {
      id: 'unpaid-alipay',
      status: 'unpaid',
      paymentMethod: 'alipay',
      autoCloseAt: '2020-01-01T00:00:00.000Z',
    });

    const result = await closeStalePendingOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(result.closed).toBe(1);
    expect(db.prepare('SELECT status, auto_close_at AS autoCloseAt FROM "Order" WHERE id = ?').get('unpaid-alipay')).toEqual({
      status: 'closed',
      autoCloseAt: null,
    });
    expect(db.prepare('SELECT fromStatus, toStatus, reason FROM OrderStatusHistory WHERE orderId = ?').get('unpaid-alipay')).toEqual({
      fromStatus: 'unpaid',
      toStatus: 'closed',
      reason: 'auto_close_timeout',
    });
  });

  it('closes expired pending transfer orders as closed', async () => {
    const db = getTestDb();
    insertOrder(db, {
      id: 'pending-transfer',
      status: 'pending',
      paymentMethod: 'bank_transfer',
      autoCloseAt: '2020-01-01T00:00:00.000Z',
    });

    const result = await closeStalePendingOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(result.closed).toBe(1);
    expect(db.prepare('SELECT status FROM "Order" WHERE id = ?').get('pending-transfer')).toEqual({ status: 'closed' });
  });

  it('does not auto-close a paid Alipay order waiting for confirmation', async () => {
    const db = getTestDb();
    insertOrder(db, {
      id: 'paid-alipay',
      status: 'pending',
      paymentMethod: 'alipay',
      paidAt: '2026-08-18T00:00:00.000Z',
      autoCloseAt: '2020-01-01T00:00:00.000Z',
    });

    const result = await closeStalePendingOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(result.closed).toBe(0);
    expect(db.prepare('SELECT status FROM "Order" WHERE id = ?').get('paid-alipay')).toEqual({ status: 'pending' });
  });

  it('returns deducted points once when an expired order closes', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'buyer-1', email: 'buyer@example.com', points: 40 });
    insertOrder(db, {
      id: 'points-order',
      status: 'pending',
      paymentMethod: 'bank_transfer',
      autoCloseAt: '2020-01-01T00:00:00.000Z',
    });
    db.prepare(`
      UPDATE "Order"
      SET customerId = 'buyer-1', total = 90, pointsDiscount = 10, pointsPersonal = 10, pointsApplied = 1
      WHERE id = 'points-order'
    `).run();

    const first = await closeStalePendingOrders(new Date('2026-08-19T00:00:00.000Z'));
    const second = await closeStalePendingOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(first).toEqual({ closed: 1, skipped: 0 });
    expect(second).toEqual({ closed: 0, skipped: 0 });
    expect(db.prepare('SELECT status FROM "Order" WHERE id = ?').get('points-order')).toEqual({ status: 'closed' });
    expect(db.prepare('SELECT pointsRefundedPersonal, pointsRefundedCash FROM "Order" WHERE id = ?').get('points-order')).toEqual({
      pointsRefundedPersonal: 10,
      pointsRefundedCash: 100,
    });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('buyer-1')).toEqual({ points: 50 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM PointsLog WHERE relatedId = ? AND type = ?').get('points-order', 'order_redeem_refund')).toEqual({ count: 1 });
  });

  it('does not close an order when deducted points cannot be returned', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'buyer-1', email: 'buyer@example.com', points: 40 });
    insertOrder(db, {
      id: 'broken-points',
      status: 'pending',
      paymentMethod: 'bank_transfer',
      autoCloseAt: '2020-01-01T00:00:00.000Z',
    });
    db.prepare(`
      UPDATE "Order"
      SET customerId = 'buyer-1', pointsGroup = 10, pointsApplied = 1
      WHERE id = 'broken-points'
    `).run();

    const result = await closeStalePendingOrders(new Date('2026-08-19T00:00:00.000Z'));

    expect(result).toEqual({ closed: 0, skipped: 1 });
    expect(db.prepare('SELECT status FROM "Order" WHERE id = ?').get('broken-points')).toEqual({ status: 'pending' });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('buyer-1')).toEqual({ points: 40 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM PointsLog').get()).toEqual({ count: 0 });
  });
});
