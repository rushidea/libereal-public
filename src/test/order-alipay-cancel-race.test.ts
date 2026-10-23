import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Run the real route handlers against shared synthetic state. Gates control the
// read/claim interleaving; this harness does not simulate database locks or rollback.
const shared = vi.hoisted(() => {
  const order = { id: 'order-race', status: 'unpaid', paidAt: null as Date | null, total: 0.3, pointsDiscount: 0, paymentMethod: 'alipay', ownerScope: 'personal', customerId: 'buyer', email: 'buyer@example.test' };
  function gate() {
    let release = () => {};
    let entered = () => {};
    let blocked = Promise.resolve();
    return {
      hold() { blocked = new Promise<void>((resolve) => { release = resolve; }); },
      block() { return blocked; },
      wait() { return new Promise<void>((resolve) => { entered = resolve; }); },
      release() { release(); },
      signal() { entered(); },
    };
  }
  const cancel = gate();
  const notify = gate();
  return {
    order,
    controls: {
      holdCancel: cancel.hold,
      blockCancel: cancel.block,
      waitCancel: cancel.wait,
      releaseCancel: cancel.release,
      cancelHasEntered: cancel.signal,
      holdNotify: notify.hold,
      blockNotify: notify.block,
      waitNotify: notify.wait,
      releaseNotify: notify.release,
      notifyHasEntered: notify.signal,
      pauseCancel: false,
      pauseNotify: false,
      pauseAttempt: false,
    },
    requireAdmin: vi.fn(async () => ({ id: 'admin', email: 'admin@example.test', role: 'admin' })),
    requireActiveSession: vi.fn(async () => ({ id: 'buyer', email: 'buyer@example.test', role: 'customer' })),
    checkNotifySign: vi.fn(() => true),
    attempt: { id: 'attempt-race', outTradeNo: 'RACE-1', amount: 0.3, status: 'created', paidAt: null, order },
    attemptUpdate: vi.fn(async () => ({})),
    attemptUpdateMany: vi.fn(async () => ({ count: 1 })),
    reserveInventory: vi.fn(async () => undefined),
    releaseInventory: vi.fn(async () => undefined),
    restoreCoupons: vi.fn(async () => 0),
    refundPoints: vi.fn(async () => ({ ok: true, personal: 0, group: 0 })),
    applyPoints: vi.fn(async () => ({ ok: true })),
    writeAudit: vi.fn(async () => undefined),
    notifyCreate: vi.fn(async () => ({})),
  };
});

vi.mock('@/lib/alipay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/alipay')>()),
  getAlipaySdk: () => ({ config: { appId: '9021000000000000', sellerId: '2088000000000000' }, sdk: { checkNotifySign: shared.checkNotifySign } }),
}));
vi.mock('@/lib/session', () => ({ requireActiveSession: shared.requireActiveSession, requireAdmin: shared.requireAdmin }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'admin', email: 'admin@example.test', role: 'admin' } })) }));
vi.mock('@/lib/admin-mfa-settings', () => ({ isAdminMfaScenarioEnabled: vi.fn(async () => false), requiresAdminMfaForPermission: vi.fn(async () => false) }));
vi.mock('@/lib/admin-mfa', () => ({ requireAdminStepUp: vi.fn(async () => true) }));
vi.mock('@/lib/audit', () => ({ writeAuditLog: shared.writeAudit }));
vi.mock('@/lib/inventory', () => ({ reserveOrderInventory: shared.reserveInventory, releaseOrderInventory: shared.releaseInventory }));
vi.mock('@/lib/coupon-service', () => ({ restoreRedeemedOrderCoupons: shared.restoreCoupons }));
vi.mock('@/lib/points-checkout-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/points-checkout-service')>()),
  applyOrderPointsDeduction: shared.applyPoints,
  refundOrderPointsProportionally: shared.refundPoints,
}));
vi.mock('@/lib/organization-record-access', () => ({ canAccessOrganizationRecord: vi.fn(async () => true) }));
vi.mock('@/lib/organization-service', () => ({ requireOrganizationPermission: vi.fn(async () => undefined) }));
vi.mock('@/lib/verified-email-access', () => ({ emailKeyedAccess: vi.fn(async () => false) }));
vi.mock('@/lib/commerce-line-catalog', () => ({ commerceLineRefFromRecord: vi.fn(), reviewCommerceLinesWithCatalog: vi.fn(async () => []) }));
vi.mock('@/lib/commerce-line-review', () => ({ decideCommerceLineReview: vi.fn(() => ({ ok: true, warnings: [] })) }));
vi.mock('@/lib/order-prepay-settlement', () => ({ ownerPrepaySettlementViews: vi.fn(async () => new Map()) }));
vi.mock('@/lib/customer-credit', () => ({ releaseOrderReceivableOnCancellation: vi.fn(), reserveOrderCredit: vi.fn(), settleOrderReceivable: vi.fn() }));

const db = vi.hoisted(() => {
  const orderUpdateMany = vi.fn(async (args: { where: { status?: string | { in: string[] }; paidAt?: null | { not: null }; total?: number }; data: Record<string, unknown> }) => {
    if (args.data.paidAt) {
      if (shared.controls.pauseNotify) {
        shared.controls.notifyHasEntered();
        await shared.controls.blockNotify();
      }
      const statusMatch = typeof args.where.status === 'object'
        ? args.where.status.in.includes(shared.order.status)
        : args.where.status === shared.order.status;
      if (!statusMatch || (args.where.paidAt === null && shared.order.paidAt) || args.where.total !== shared.order.total) return { count: 0 };
      shared.order.paidAt = new Date();
      shared.order.status = 'pending';
      return { count: 1 };
    }
    if (shared.controls.pauseCancel) {
      shared.controls.cancelHasEntered();
      await shared.controls.blockCancel();
    }
    if (args.where.status !== shared.order.status || (args.where.paidAt === null && shared.order.paidAt)) return { count: 0 };
    shared.order.status = String(args.data.status);
    return { count: 1 };
  });
  const tx = {
    $executeRawUnsafe: vi.fn(async () => 0),
    order: {
      updateMany: orderUpdateMany,
      update: vi.fn(async ({ data }: { data: { status?: string } }) => {
        if (data.status) shared.order.status = data.status;
        return { ...shared.order };
      }),
      findUnique: vi.fn(async () => ({ ...shared.order })),
    },
    paymentAttempt: {
      findUnique: vi.fn(async () => {
        if (shared.controls.pauseAttempt) {
          shared.controls.notifyHasEntered();
          await shared.controls.blockNotify();
        }
        return { ...shared.attempt, order: { ...shared.order } };
      }),
      update: shared.attemptUpdate,
      updateMany: shared.attemptUpdateMany,
    },
    accountReceivable: { findUnique: vi.fn(async () => null) },
  };
  return {
    tx,
    orderUpdateMany,
    prisma: {
      order: { findUnique: vi.fn(async () => ({ ...shared.order, adjustments: [], paymentAttempts: [], total: shared.order.total, pointsDiscount: 0 })) },
      paymentAttempt: { findUnique: vi.fn(async () => shared.attempt) },
      notification: { create: shared.notifyCreate },
      accountReceivable: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    },
  };
});
vi.mock('@/lib/prisma', () => ({ prisma: db.prisma }));

import { PATCH as customerPatch } from '@/app/api/orders/[id]/route';
import { PATCH as adminPatch } from '@/app/api/admin/orders/[id]/route';
import { POST as alipayNotify } from '@/app/api/payments/alipay/notify/route';

function cancelRequest(admin: boolean) {
  return new NextRequest(`https://libereal.cn/api/${admin ? 'admin/' : ''}orders/order-race`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }),
  });
}

function notifyRequest() {
  const body = new URLSearchParams({ app_id: '9021000000000000', seller_id: '2088000000000000', out_trade_no: 'RACE-1', total_amount: '0.30', trade_status: 'TRADE_SUCCESS', trade_no: 'TRADE-RACE', sign_type: 'RSA2', sign: 'signed' });
  return new Request('https://libereal.cn/api/payments/alipay/notify', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
}

describe('Alipay notify and order cancellation races', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(shared.order, { status: 'unpaid', paidAt: null, total: 0.3, paymentMethod: 'alipay', ownerScope: 'personal', customerId: 'buyer' });
    Object.assign(shared.attempt, { status: 'created', paidAt: null });
    shared.controls.pauseCancel = false;
    shared.controls.pauseNotify = false;
    shared.controls.pauseAttempt = false;
  });

  it.each([
    { name: 'customer route from unpaid', admin: false, status: 'unpaid' },
    { name: 'admin route from unpaid', admin: true, status: 'unpaid' },
    { name: 'customer route from pending', admin: false, status: 'pending' },
    { name: 'admin route from pending', admin: true, status: 'pending' },
  ])('$name loses after Alipay notify claims payment', async ({ admin, status }) => {
    shared.order.status = status;
    shared.controls.pauseCancel = true;
    void shared.controls.holdCancel();
    const cancelEntered = shared.controls.waitCancel();
    const cancelPromise = (admin ? adminPatch : customerPatch)(cancelRequest(admin), { params: Promise.resolve({ id: 'order-race' }) });
    await cancelEntered;
    const notifyResponse = await alipayNotify(notifyRequest());
    shared.controls.releaseCancel();
    const cancelResponse = await cancelPromise;

    expect(notifyResponse.status).toBe(200);
    await expect(notifyResponse.text()).resolves.toBe('success');
    expect(cancelResponse.status).toBe(409);
    await expect(cancelResponse.json()).resolves.toEqual({ error: 'ORDER_CANCELLATION_CONFLICT' });
    expect(db.tx.order.update).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'cancelled' }),
    }));
    expect(shared.notifyCreate).not.toHaveBeenCalled();
    expect(shared.order.status).toBe('pending');
    expect(shared.order.paidAt).toBeInstanceOf(Date);
    expect(shared.reserveInventory).toHaveBeenCalledTimes(1);
    expect(shared.releaseInventory).not.toHaveBeenCalled();
    expect(shared.restoreCoupons).not.toHaveBeenCalled();
    expect(shared.refundPoints).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'customer route before callback snapshot', admin: false, atClaim: false },
    { name: 'admin route before callback snapshot', admin: true, atClaim: false },
    { name: 'customer route after callback snapshot', admin: false, atClaim: true },
    { name: 'admin route after callback snapshot', admin: true, atClaim: true },
  ])('Alipay notify loses after $name claims the order', async ({ admin, atClaim }) => {
    shared.controls.pauseAttempt = !atClaim;
    shared.controls.pauseNotify = atClaim;
    void shared.controls.holdNotify();
    const notifyEntered = shared.controls.waitNotify();
    const notifyPromise = alipayNotify(notifyRequest());
    await notifyEntered;
    const cancelResponse = await (admin ? adminPatch : customerPatch)(cancelRequest(admin), { params: Promise.resolve({ id: 'order-race' }) });
    shared.controls.releaseNotify();
    const notifyResponse = await notifyPromise;

    expect(cancelResponse.status).toBe(200);
    expect(notifyResponse.status).toBe(200);
    await expect(notifyResponse.text()).resolves.toBe('success');
    expect(shared.order.status).toBe('cancelled');
    expect(shared.order.paidAt).toBeNull();
    expect(shared.reserveInventory).toHaveBeenCalledTimes(atClaim ? 1 : 0);
    expect(shared.releaseInventory).toHaveBeenCalledTimes(atClaim ? 2 : 1);
    expect(shared.restoreCoupons).toHaveBeenCalledTimes(1);
    expect(shared.refundPoints).toHaveBeenCalledTimes(1);
    expect(shared.applyPoints).not.toHaveBeenCalled();
    expect(shared.attemptUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'rejected_order_cancelled' }),
    }));
  });
});
