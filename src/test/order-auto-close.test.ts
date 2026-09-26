import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closeStalePendingOrders, orderAutoCloseAt } from '@/lib/order-auto-close';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

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
});
