import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';
import { prisma } from '@/lib/prisma';
import { applyOrderPointsDeduction } from '@/lib/points-checkout-service';
import { reconcilePendingAlipayOrderPoints } from '@/lib/order-auto-close';

vi.mock('@/lib/alipay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/alipay')>();
  return {
    ...actual,
    getAlipaySdk: () => ({
      config: { appId: '9021000000000000', sellerId: '2088000000000000' },
      sdk: { checkNotifySign: () => true },
    }),
  };
});

import { POST } from '@/app/api/payments/alipay/notify/route';

type OrderSeed = {
  id: string;
  customerId: string;
  status?: string;
  paidAt?: string | null;
  pointsPersonal?: number;
  pointsGroup?: number;
  pointsGroupId?: string | null;
  pointsApplied?: number;
  pointsAppliedAt?: string | null;
  total?: number;
};

function insertUser(id: string, points: number) {
  getTestDb().prepare(`
    INSERT INTO User (id, email, points, createdAt, updatedAt)
    VALUES (?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, `${id}@example.com`, points);
}

function insertGroup(id: string, points: number) {
  getTestDb().prepare(`
    INSERT INTO ResearchGroup (id, name, points, status, locked, createdAt, updatedAt)
    VALUES (?, '课题组', ?, 'active', 0, datetime('now'), datetime('now'))
  `).run(id, points);
}

function insertOrder(order: OrderSeed) {
  getTestDb().prepare(`
    INSERT INTO "Order" (
      id, email, customerId, subtotal, total, status, paymentMethod, owner_scope, shippingMethod, operationLogs,
      createdAt, updatedAt, paidAt, pointsPersonal, pointsGroup, pointsGroupId, pointsDiscount, pointsApplied, pointsAppliedAt
    ) VALUES (
      ?, ?, ?, ?, ?, ?, 'alipay', 'personal', 'logistics', '[]',
      datetime('now'), datetime('now'), ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    order.id,
    `${order.customerId}@example.com`,
    order.customerId,
    order.total ?? 100,
    order.total ?? 100,
    order.status ?? 'pending',
    order.paidAt === undefined ? '2026-08-18T00:00:00.000Z' : order.paidAt,
    order.pointsPersonal ?? 0,
    order.pointsGroup ?? 0,
    order.pointsGroupId ?? null,
    (order.pointsPersonal ?? 0) + (order.pointsGroup ?? 0),
    order.pointsApplied ?? 0,
    order.pointsAppliedAt ?? null,
  );
}

function insertPointsLog(id: string, userId: string, orderId: string, delta: number, type: string, reason: string) {
  getTestDb().prepare(`
    INSERT INTO PointsLog (id, userId, delta, type, reason, relatedId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, userId, delta, type, reason, orderId);
}

function notifyRequest() {
  const body = new URLSearchParams({
    app_id: '9021000000000000',
    seller_id: '2088000000000000',
    out_trade_no: 'LPTEST001',
    total_amount: '100.00',
    trade_status: 'TRADE_SUCCESS',
    trade_no: '202608180001',
    sign_type: 'RSA2',
    sign: 'signed-value',
  });
  return new Request('https://libereal.cn/api/payments/alipay/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('Alipay points settlement consistency', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => { clearAllTables(getTestDb()); });

  it('keeps pointsApplied false when a committed deduction attempt cannot charge the customer', async () => {
    insertUser('user-short', 3);
    insertOrder({
      id: 'order-short',
      customerId: 'user-short',
      pointsPersonal: 10,
      pointsApplied: 0,
    });

    await prisma.$transaction(async (tx) => {
      await expect(applyOrderPointsDeduction(tx, 'order-short')).resolves.toEqual({
        ok: false,
        error: '个人积分不足',
      });
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: 'order-short' } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: 'user-short' } });
    expect(order.pointsApplied).toBe(false);
    expect(order.pointsAppliedAt).toBeNull();
    expect(user.points).toBe(3);
    expect(await prisma.pointsLog.count({ where: { relatedId: 'order-short' } })).toBe(0);
  });

  it('records the Alipay payment and leaves points unsettled when deduction fails', async () => {
    insertUser('user-notify', 0);
    insertOrder({
      id: 'order-notify',
      customerId: 'user-notify',
      status: 'unpaid',
      paidAt: null,
      pointsPersonal: 10,
      pointsApplied: 0,
    });
    getTestDb().prepare(`
      INSERT INTO PaymentAttempt (
        id, orderId, provider, outTradeNo, amount, status, createdAt, updatedAt
      ) VALUES ('attempt-notify', 'order-notify', 'alipay', 'LPTEST001', 100, 'created', datetime('now'), datetime('now'))
    `).run();

    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('success');
    const order = await prisma.order.findUniqueOrThrow({ where: { id: 'order-notify' } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: 'user-notify' } });
    const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: 'attempt-notify' } });
    expect(order.status).toBe('pending');
    expect(order.paidAt).not.toBeNull();
    expect(order.pointsApplied).toBe(false);
    expect(user.points).toBe(0);
    expect(attempt.status).toBe('paid');
    expect(await prisma.pointsLog.count({ where: { relatedId: 'order-notify', type: 'order_redeem' } })).toBe(0);
    expect(await prisma.orderEvent.findFirst({
      where: { orderId: 'order-notify', type: 'points_settlement_pending' },
    })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({
      where: { targetId: 'order-notify', action: 'payment.alipay_points_pending' },
    })).not.toBeNull();
  });

  it('retries an unsettled paid order and does not deduct twice after it succeeds', async () => {
    insertUser('user-retry', 0);
    insertOrder({
      id: 'order-retry',
      customerId: 'user-retry',
      pointsPersonal: 10,
      pointsApplied: 0,
    });

    const first = await reconcilePendingAlipayOrderPoints();
    expect(first).toEqual({ reconciled: 0, failed: 1 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: 'order-retry' } })).pointsApplied).toBe(false);
    expect(await prisma.auditLog.count({
      where: { targetId: 'order-retry', action: 'payment.alipay_points_reconcile_failed' },
    })).toBe(1);

    const second = await reconcilePendingAlipayOrderPoints();
    expect(second.failed).toBe(1);
    expect(await prisma.orderEvent.count({
      where: { orderId: 'order-retry', type: 'points_settlement_pending' },
    })).toBe(1);

    await prisma.user.update({ where: { id: 'user-retry' }, data: { points: 10 } });
    const third = await reconcilePendingAlipayOrderPoints();
    expect(third).toEqual({ reconciled: 1, failed: 0 });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: 'user-retry' } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: 'order-retry' } });
    expect(user.points).toBe(0);
    expect(order.pointsApplied).toBe(true);
    expect(await prisma.pointsLog.findMany({
      where: { relatedId: 'order-retry', type: 'order_redeem' },
    })).toEqual([expect.objectContaining({ delta: -10 })]);

    const fourth = await reconcilePendingAlipayOrderPoints();
    expect(fourth).toEqual({ reconciled: 0, failed: 0 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'user-retry' } })).points).toBe(0);
  });

  it('repairs an order marked applied when the negative ledger is missing or was rolled back', async () => {
    insertUser('user-marked', 40);
    insertOrder({
      id: 'order-marked',
      customerId: 'user-marked',
      pointsPersonal: 15,
      pointsApplied: 1,
      pointsAppliedAt: '2026-08-01T00:00:00.000Z',
    });
    insertOrder({
      id: 'order-rolled-back',
      customerId: 'user-marked',
      pointsPersonal: 10,
      pointsApplied: 1,
      pointsAppliedAt: '2026-08-02T00:00:00.000Z',
    });
    insertPointsLog('log-redeem', 'user-marked', 'order-rolled-back', -10, 'order_redeem', '订单积分抵扣');
    insertPointsLog('log-rollback', 'user-marked', 'order-rolled-back', 10, 'order_redeem_refund', '课题组扣减失败回滚');
    insertOrder({
      id: 'order-settled',
      customerId: 'user-marked',
      pointsPersonal: 5,
      pointsApplied: 1,
      pointsAppliedAt: '2026-08-03T00:00:00.000Z',
    });
    insertPointsLog('log-settled', 'user-marked', 'order-settled', -5, 'order_redeem', '订单积分抵扣');
    insertOrder({
      id: 'order-refunded',
      customerId: 'user-marked',
      pointsPersonal: 7,
      pointsApplied: 1,
      pointsAppliedAt: '2026-08-04T00:00:00.000Z',
    });
    insertPointsLog('log-refund-redeem', 'user-marked', 'order-refunded', -7, 'order_redeem', '订单积分抵扣');
    insertPointsLog('log-refund', 'user-marked', 'order-refunded', 7, 'order_redeem_refund', '订单退款退回积分');

    const result = await reconcilePendingAlipayOrderPoints();

    expect(result).toEqual({ reconciled: 2, failed: 0 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'user-marked' } })).points).toBe(15);
    expect(await prisma.pointsLog.count({ where: { relatedId: 'order-marked', type: 'order_redeem' } })).toBe(1);
    expect(await prisma.pointsLog.count({ where: { relatedId: 'order-rolled-back', type: 'order_redeem' } })).toBe(2);
    expect(await prisma.pointsLog.count({ where: { relatedId: 'order-settled', type: 'order_redeem' } })).toBe(1);
    expect(await prisma.pointsLog.count({ where: { relatedId: 'order-refunded', type: 'order_redeem' } })).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: 'order-marked' } })).pointsApplied).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: 'order-rolled-back' } })).pointsApplied).toBe(true);
  });

  it('fills a missing group deduction without charging personal points again', async () => {
    insertUser('user-group', 90);
    insertGroup('group-1', 0);
    insertOrder({
      id: 'order-group',
      customerId: 'user-group',
      pointsPersonal: 10,
      pointsGroup: 15,
      pointsGroupId: 'group-1',
      pointsApplied: 1,
      pointsAppliedAt: '2026-08-01T00:00:00.000Z',
    });
    insertPointsLog('log-personal', 'user-group', 'order-group', -10, 'order_redeem', '订单积分抵扣');

    const failed = await reconcilePendingAlipayOrderPoints();
    expect(failed).toEqual({ reconciled: 0, failed: 1 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'user-group' } })).points).toBe(90);
    expect((await prisma.researchGroup.findUniqueOrThrow({ where: { id: 'group-1' } })).points).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: 'order-group' } })).pointsApplied).toBe(true);
    expect(await prisma.auditLog.findFirst({
      where: { targetId: 'order-group', action: 'payment.alipay_points_reconcile_failed' },
    })).not.toBeNull();

    await prisma.researchGroup.update({ where: { id: 'group-1' }, data: { points: 20 } });
    const repaired = await reconcilePendingAlipayOrderPoints();
    expect(repaired).toEqual({ reconciled: 1, failed: 0 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'user-group' } })).points).toBe(90);
    expect((await prisma.researchGroup.findUniqueOrThrow({ where: { id: 'group-1' } })).points).toBe(5);
    expect(await prisma.groupPointsLog.findMany({ where: { relatedId: 'order-group', type: 'order_redeem' } })).toEqual([
      expect.objectContaining({ delta: -15, groupId: 'group-1' }),
    ]);
  });

  it('does not retry a cancelled order or an order that was never paid', async () => {
    insertUser('user-skip', 30);
    insertOrder({
      id: 'order-cancelled',
      customerId: 'user-skip',
      status: 'cancelled',
      pointsPersonal: 10,
      pointsApplied: 1,
    });
    insertOrder({
      id: 'order-unpaid',
      customerId: 'user-skip',
      status: 'unpaid',
      paidAt: null,
      pointsPersonal: 10,
      pointsApplied: 0,
    });

    await expect(reconcilePendingAlipayOrderPoints()).resolves.toEqual({ reconciled: 0, failed: 0 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'user-skip' } })).points).toBe(30);
  });
});
