import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redeemCoupon, restoreRedeemedOrderCoupons } from '@/lib/coupon-service';
import { closeStalePendingOrders } from '@/lib/order-auto-close';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));
vi.mock('@/lib/admin-mfa-settings', () => ({
  isAdminMfaScenarioEnabled: vi.fn(async () => false),
  requiresAdminMfaForPermission: vi.fn(async () => false),
}));

import { PATCH as adminOrderPATCH } from '@/app/api/admin/orders/[id]/route';

async function seedCoupon(code: string, orderId: string | null) {
  const coupon = await prisma.coupon.create({
    data: {
      name: '满100减10',
      type: 'threshold',
      threshold: 100,
      discount: 10,
      stackable: false,
      requiresApproval: false,
      approvalStatus: 'auto',
      maxUses: 0,
    },
  });
  await prisma.couponInstance.create({
    data: {
      couponId: coupon.id,
      userId: 'buyer-1',
      code,
      status: 'active',
      issueApprovalStatus: 'auto',
    },
  });
  if (orderId) {
    await prisma.$transaction(async (tx) => {
      const redeemed = await redeemCoupon(tx, code, 'buyer-1', 200, orderId);
      expect(redeemed.ok).toBe(true);
    });
  }
  return coupon.id;
}

function insertOrder(id: string, status: string, autoCloseAt: string | null) {
  getTestDb().prepare(`
    INSERT INTO "Order" (
      id, email, subtotal, total, status, paymentMethod, owner_scope, shippingMethod, operationLogs,
      createdAt, updatedAt, auto_close_at
    ) VALUES (?, 'buyer@example.com', 200, 190, ?, 'bank_transfer', 'personal', 'logistics', '[]', datetime('now'), datetime('now'), ?)
  `).run(id, status, autoCloseAt);
}

describe('order coupon restore', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    clearAllTables(getTestDb());
    seedAdmin(getTestDb());
  });

  it('restores every coupon bound to the order exactly once', async () => {
    await seedCoupon('ONCE-A', 'order-a');
    await seedCoupon('ONCE-B', 'order-a');
    await seedCoupon('OTHER', 'order-b');

    const first = await prisma.$transaction((tx) => restoreRedeemedOrderCoupons(tx, 'order-a'));
    const second = await prisma.$transaction((tx) => restoreRedeemedOrderCoupons(tx, 'order-a'));

    expect(first).toBe(2);
    expect(second).toBe(0);
    for (const code of ['ONCE-A', 'ONCE-B']) {
      expect(await prisma.couponInstance.findUnique({ where: { code }, include: { coupon: true } })).toMatchObject({
        status: 'active',
        redeemedOrderId: null,
        redeemedAt: null,
        coupon: { usedCount: 0 },
      });
    }
    expect(await prisma.couponInstance.findUnique({ where: { code: 'OTHER' }, include: { coupon: true } })).toMatchObject({
      status: 'used',
      redeemedOrderId: 'order-b',
      coupon: { usedCount: 1 },
    });
  });

  it('restores the coupon when an admin cancels the order and not again afterwards', async () => {
    insertOrder('order-cancel', 'pending', null);
    await seedCoupon('CANCEL-ME', 'order-cancel');

    const response = await adminOrderPATCH(
      new NextRequest('http://localhost:3000/api/admin/orders/order-cancel', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', reason: '管理员取消' }),
      }),
      { params: Promise.resolve({ id: 'order-cancel' }) },
    );

    expect(response.status).toBe(200);
    expect(await prisma.couponInstance.findUnique({ where: { code: 'CANCEL-ME' }, include: { coupon: true } })).toMatchObject({
      status: 'active',
      redeemedOrderId: null,
      coupon: { usedCount: 0 },
    });

    const again = await prisma.$transaction((tx) => restoreRedeemedOrderCoupons(tx, 'order-cancel'));
    expect(again).toBe(0);
    expect((await prisma.coupon.findFirst({ where: { instances: { some: { code: 'CANCEL-ME' } } } }))?.usedCount).toBe(0);
  });

  it('restores the coupon when a stale order auto-closes and does not restore it twice', async () => {
    insertOrder('order-stale', 'unpaid', '2020-01-01T00:00:00.000Z');
    await seedCoupon('STALE-ME', 'order-stale');

    const closed = await closeStalePendingOrders(new Date('2026-08-19T00:00:00.000Z'));
    expect(closed).toEqual({ closed: 1, skipped: 0 });
    expect(await prisma.order.findUnique({ where: { id: 'order-stale' }, select: { status: true } })).toEqual({ status: 'closed' });
    expect(await prisma.couponInstance.findUnique({ where: { code: 'STALE-ME' }, include: { coupon: true } })).toMatchObject({
      status: 'active',
      redeemedOrderId: null,
      coupon: { usedCount: 0 },
    });

    const repeat = await closeStalePendingOrders(new Date('2026-08-19T00:00:00.000Z'));
    expect(repeat.closed).toBe(0);
    const direct = await prisma.$transaction((tx) => restoreRedeemedOrderCoupons(tx, 'order-stale'));
    expect(direct).toBe(0);
    expect((await prisma.coupon.findFirst({ where: { instances: { some: { code: 'STALE-ME' } } } }))?.usedCount).toBe(0);
  });
});
