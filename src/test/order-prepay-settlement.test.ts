import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';
import { PREPAY_POINTS_RELEASE_REASON } from '@/lib/points-checkout-service';

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => authMock(...args),
}));

import { POST as quotePOST } from '@/app/api/inquiries/[id]/quote/route';
import { POST as confirmQuotePOST } from '@/app/api/orders/[id]/confirm-items/route';
import { GET as orderGET } from '@/app/api/orders/[id]/route';
import { POST as settlePOST } from '@/app/api/orders/[id]/prepay-settlement/route';
import { POST as previewPOST } from '@/app/api/orders/[id]/prepay-settlement/preview/route';

const admin = { id: 'admin_test_id', email: 'admin@test.com', role: 'admin' as const };
const buyer = { id: 'buyer_points', email: 'q@test.com', role: 'customer' as const };

function asUser(user: { id: string; email: string; role: 'admin' | 'customer' }) {
  authMock.mockResolvedValue({
    user: {
      id: user.id,
      email: user.email,
      name: user.role === 'admin' ? 'Admin' : '询价人',
      role: user.role,
      sessionId: `session-${user.id}`,
    },
  });
}

function seedInquiry(db: ReturnType<typeof getTestDb>) {
  db.prepare(`
    INSERT INTO Inquiry (id, name, email, phone, institution, status, createdAt, operationLogs)
    VALUES ('i1', '询价人', 'q@test.com', '13800000000', '清华大学', 'pending_quote', datetime('now'), '[]')
  `).run();
  db.prepare(`
    INSERT INTO InquiryItem (id, inquiryId, position, productId, name, unitPrice, quantity, lineTotal, createdAt, updatedAt)
    VALUES ('i1_item_0', 'i1', 0, 'p1', 'A', 100, 1, 100, datetime('now'), datetime('now'))
  `).run();
  db.prepare('UPDATE Inquiry SET userId = ? WHERE id = ?').run('buyer_points', 'i1');
}

function seedCoupon(db: ReturnType<typeof getTestDb>, coupon: {
  code: string;
  threshold?: number;
  discount?: number;
  userId?: string | null;
  status?: string;
  redeemedOrderId?: string | null;
  maxUses?: number;
  usedCount?: number;
}) {
  const couponId = `coupon_${coupon.code}`;
  db.prepare(`
    INSERT INTO Coupon (
      id, name, type, threshold, discount, stackable, approvalStatus, maxUses, usedCount,
      scopeType, scopeTargets, createdAt, updatedAt
    ) VALUES (?, ?, 'threshold', ?, ?, 0, 'auto', ?, ?, 'all', '[]', datetime('now'), datetime('now'))
  `).run(
    couponId,
    `券${coupon.code}`,
    coupon.threshold ?? 100,
    coupon.discount ?? 10,
    coupon.maxUses ?? 0,
    coupon.usedCount ?? 0,
  );
  db.prepare(`
    INSERT INTO CouponInstance (
      id, couponId, userId, code, status, issueApprovalStatus, redeemedOrderId, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, 'auto', ?, datetime('now'), datetime('now'))
  `).run(
    `inst_${coupon.code}`,
    couponId,
    coupon.userId === undefined ? 'buyer_points' : coupon.userId,
    coupon.code,
    coupon.status ?? 'active',
    coupon.redeemedOrderId ?? null,
  );
}

function orderRow() {
  return getTestDb().prepare(`
    SELECT id, total, subtotal, adjustmentTotal, status, paymentMethod, paidAt,
           pointsPersonal, pointsGroup, pointsGroupId, pointsDiscount, pointsApplied, customerId
    FROM "Order"
  `).get() as {
    id: string;
    total: number;
    subtotal: number;
    adjustmentTotal: number;
    status: string;
    paymentMethod: string;
    paidAt: string | null;
    pointsPersonal: number;
    pointsGroup: number;
    pointsGroupId: string | null;
    pointsDiscount: number;
    pointsApplied: number;
    customerId: string;
  };
}

async function quotedId() {
  asUser(admin);
  const response = await quotePOST(new NextRequest('http://localhost:3000/api/inquiries/i1/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ productId: 'p1', name: 'A', price: 150, quantity: 2 }] }),
  }), { params: Promise.resolve({ id: 'i1' }) });
  expect(response.status).toBe(200);
  return (getTestDb().prepare('SELECT id FROM Quote WHERE inquiryId = ?').get('i1') as { id: string }).id;
}

async function acceptQuote(actor: typeof admin | typeof buyer, body: Record<string, unknown>, attemptId: string) {
  const quoteId = await quotedId();
  asUser(actor);
  const response = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      itemIndices: [0],
      quantities: { 0: 2 },
      quoteId,
      quoteVersion: 1,
      acceptanceAttemptId: attemptId,
      acceptedLegalIds: ['site-sales-terms', 'customer-purchase'],
      ...body,
    }),
  }), { params: Promise.resolve({ id: 'i1' }) });
  expect(response.status, await response.clone().text()).toBe(200);
  return orderRow();
}

function settle(orderId: string, body: Record<string, unknown>, idempotencyKey?: string) {
  return settlePOST(new NextRequest(`http://localhost:3000/api/orders/${orderId}/prepay-settlement`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: orderId }) });
}

function preview(orderId: string, body: Record<string, unknown>) {
  return previewPOST(new NextRequest(`http://localhost:3000/api/orders/${orderId}/prepay-settlement/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: orderId }) });
}

describe('POST /api/orders/[id]/prepay-settlement', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'buyer_points', email: 'q@test.com', name: '询价人', points: 40, role: 'customer' });
    seedInquiry(db);
  });

  it('lets the order owner apply personal points before paying a proxy-accepted order', async () => {
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-alipay');
    expect(created).toMatchObject({ total: 300, status: 'unpaid', pointsApplied: 0, customerId: 'buyer_points' });
    asUser(buyer);

    const response = await settle(created.id, { personalPoints: 40 });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      replayed: false,
      unchanged: false,
      order: { total: 260, pointsPersonal: 40, pointsDiscount: 40, pointsApplied: true },
    });

    const db = getTestDb();
    expect(orderRow()).toMatchObject({ total: 260, pointsPersonal: 40, pointsDiscount: 40, pointsApplied: 1 });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 0 });
    expect(db.prepare('SELECT delta, type FROM PointsLog WHERE userId = ?').all('buyer_points')).toEqual([
      { delta: -40, type: 'order_redeem' },
    ]);
  });

  it('releases the previous hold and deducts the new amount when points change', async () => {
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-change');
    asUser(buyer);
    expect((await settle(created.id, { personalPoints: 40 })).status).toBe(200);

    const response = await settle(created.id, { personalPoints: 10 });
    expect(response.status).toBe(200);
    expect(orderRow()).toMatchObject({ total: 290, pointsPersonal: 10, pointsApplied: 1 });
    expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 30 });
    expect(getTestDb().prepare(`
      SELECT delta, type, reason FROM PointsLog WHERE userId = ? ORDER BY rowid
    `).all('buyer_points')).toEqual([
      { delta: -40, type: 'order_redeem', reason: '订单积分抵扣' },
      { delta: 40, type: 'order_redeem_refund', reason: PREPAY_POINTS_RELEASE_REASON },
      { delta: -10, type: 'order_redeem', reason: '订单积分抵扣' },
    ]);
  });

  it('redeems a coupon before points and restores it when cleared', async () => {
    const db = getTestDb();
    seedCoupon(db, { code: 'SAVE10', threshold: 100, discount: 10 });
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-coupon');
    asUser(buyer);

    const applied = await settle(created.id, { personalPoints: 40, couponCode: 'SAVE10' });
    expect(applied.status).toBe(200);
    expect(orderRow()).toMatchObject({ total: 250, pointsPersonal: 40, pointsDiscount: 40 });
    expect(db.prepare('SELECT status, redeemedOrderId, usedCount FROM CouponInstance JOIN Coupon ON Coupon.id = CouponInstance.couponId WHERE code = ?').get('SAVE10')).toEqual({
      status: 'used',
      redeemedOrderId: created.id,
      usedCount: 1,
    });

    const again = await settle(created.id, { personalPoints: 40, couponCode: 'SAVE10' });
    expect(again.status).toBe(200);
    await expect(again.json()).resolves.toMatchObject({ unchanged: true });
    expect(db.prepare('SELECT usedCount FROM Coupon WHERE id = ?').get('coupon_SAVE10')).toEqual({ usedCount: 1 });

    const cleared = await settle(created.id, { personalPoints: 40, couponCode: '' });
    expect(cleared.status).toBe(200);
    expect(orderRow().total).toBe(260);
    expect(db.prepare('SELECT status, redeemedOrderId FROM CouponInstance WHERE code = ?').get('SAVE10')).toEqual({
      status: 'active',
      redeemedOrderId: null,
    });
    expect(db.prepare('SELECT usedCount FROM Coupon WHERE id = ?').get('coupon_SAVE10')).toEqual({ usedCount: 0 });
  });

  it('keeps existing points when the request only changes the coupon', async () => {
    const db = getTestDb();
    seedCoupon(db, { code: 'SAVE10' });
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-keep-points');
    asUser(buyer);
    expect((await settle(created.id, { personalPoints: 40 })).status).toBe(200);

    const response = await settle(created.id, { couponCode: 'SAVE10' });
    expect(response.status).toBe(200);
    expect(orderRow()).toMatchObject({ total: 250, pointsPersonal: 40, pointsApplied: 1 });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 0 });
  });

  it('rejects an unavailable coupon and a coupon below its threshold', async () => {
    const db = getTestDb();
    seedCoupon(db, { code: 'USED', status: 'used', redeemedOrderId: 'other-order' });
    seedCoupon(db, { code: 'HIGH', threshold: 1000, discount: 10 });
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-bad-coupon');
    asUser(buyer);

    const used = await settle(created.id, { couponCode: 'USED' });
    expect(used.status).toBe(400);
    expect(await used.json()).toMatchObject({ error: '优惠券不可用（已使用/已作废）', code: 'COUPON_INVALID' });

    const high = await settle(created.id, { couponCode: 'HIGH' });
    expect(high.status).toBe(400);
    expect((await high.json()).error).toContain('还差');
    expect(orderRow().total).toBe(300);
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 40 });
  });

  it('rejects insufficient points without a partial deduction', async () => {
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-short');
    asUser(buyer);
    const response = await settle(created.id, { personalPoints: 10000 });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: '个人积分不足', code: 'POINTS_INVALID' });
    expect(orderRow()).toMatchObject({ total: 300, pointsPersonal: 0, pointsApplied: 0 });
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM PointsLog').get()).toEqual({ count: 0 });
    expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 40 });
  });

  it('forbids an admin from choosing points or coupons before payment', async () => {
    const db = getTestDb();
    seedCoupon(db, { code: 'SAVE10' });
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-admin-block');
    asUser(admin);
    const response = await settle(created.id, { personalPoints: 0, couponCode: 'SAVE10' });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'ADMIN_PREPAY_SETTLEMENT_FORBIDDEN' });
    expect(orderRow()).toMatchObject({ total: 300, pointsPersonal: 0 });
    expect(db.prepare('SELECT status FROM CouponInstance WHERE code = ?').get('SAVE10')).toEqual({ status: 'active' });
  });

  it('does not rewrite an order the customer already accepted', async () => {
    const withPoints = await acceptQuote(buyer, { paymentMethod: 'alipay', personalPoints: 40 }, 'self-points');
    expect(withPoints).toMatchObject({ total: 260, pointsPersonal: 40, pointsApplied: 1 });
    asUser(buyer);
    const blocked = await settle(withPoints.id, { personalPoints: 10 });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: 'ORDER_NOT_PROXY_ACCEPTED' });
    expect(orderRow()).toMatchObject({ total: 260, pointsPersonal: 40 });
    expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 0 });

    clearAllTables(getTestDb());
    seedAdmin(getTestDb());
    seedUser(getTestDb(), { id: 'buyer_points', email: 'q@test.com', name: '询价人', points: 40, role: 'customer' });
    seedInquiry(getTestDb());
    const withoutPoints = await acceptQuote(buyer, { paymentMethod: 'alipay' }, 'self-zero');
    asUser(buyer);
    const alsoBlocked = await settle(withoutPoints.id, { personalPoints: 40 });
    expect(alsoBlocked.status).toBe(409);
    expect(await alsoBlocked.json()).toMatchObject({ code: 'ORDER_NOT_PROXY_ACCEPTED' });
    expect(orderRow()).toMatchObject({ total: 300, pointsPersonal: 0, pointsApplied: 0 });
    expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 40 });
  });

  it('rejects paid, cancelled, confirmed, and already-paid payment attempts', async () => {
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-boundaries');
    asUser(buyer);
    const db = getTestDb();

    db.prepare(`UPDATE "Order" SET paidAt = datetime('now') WHERE id = ?`).run(created.id);
    const paid = await settle(created.id, { personalPoints: 10 });
    expect(paid.status).toBe(409);
    expect(await paid.json()).toMatchObject({ code: 'ORDER_ALREADY_PAID' });

    db.prepare(`UPDATE "Order" SET paidAt = NULL, status = 'cancelled' WHERE id = ?`).run(created.id);
    const cancelled = await settle(created.id, { personalPoints: 10 });
    expect(cancelled.status).toBe(409);
    expect(await cancelled.json()).toMatchObject({ code: 'ORDER_INACTIVE' });

    db.prepare(`UPDATE "Order" SET status = 'confirmed' WHERE id = ?`).run(created.id);
    const confirmed = await settle(created.id, { personalPoints: 10 });
    expect(confirmed.status).toBe(409);
    expect(await confirmed.json()).toMatchObject({ code: 'ORDER_IN_FULFILLMENT' });

    db.prepare(`UPDATE "Order" SET status = 'unpaid' WHERE id = ?`).run(created.id);
    db.prepare(`
      INSERT INTO PaymentAttempt (id, orderId, provider, outTradeNo, amount, status, createdAt, updatedAt)
      VALUES ('paid-attempt', ?, 'alipay', 'LPPAID', 300, 'paid', datetime('now'), datetime('now'))
    `).run(created.id);
    const paidAttempt = await settle(created.id, { personalPoints: 10 });
    expect(paidAttempt.status).toBe(409);
    expect(await paidAttempt.json()).toMatchObject({ code: 'ORDER_ALREADY_PAID' });
    expect(orderRow().pointsPersonal).toBe(0);
  });

  it('replays the same idempotency key and rejects a different selection', async () => {
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-idem');
    asUser(buyer);
    const first = await settle(created.id, { personalPoints: 40 }, 'idem-1');
    expect(first.status).toBe(200);
    const second = await settle(created.id, { personalPoints: 40 }, 'idem-1');
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ replayed: true, unchanged: true });
    expect(getTestDb().prepare(`SELECT COUNT(*) AS count FROM PointsLog WHERE type = 'order_redeem'`).get()).toEqual({ count: 1 });
    expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 0 });

    const conflict = await settle(created.id, { personalPoints: 10 }, 'idem-1');
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(orderRow()).toMatchObject({ total: 260, pointsPersonal: 40 });
  });

  it('deducts personal and group points for the customer membership', async () => {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO ResearchGroup (id, name, points, status, locked, createdAt, updatedAt)
      VALUES ('g1', '课题组', 100, 'active', 0, datetime('now'), datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO ResearchGroupMember (id, groupId, userId, role, createdAt)
      VALUES ('m1', 'g1', 'buyer_points', 'member', datetime('now'))
    `).run();
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-group');
    asUser(buyer);

    const response = await settle(created.id, { personalPoints: 10, groupPoints: 20 });
    expect(response.status).toBe(200);
    expect(orderRow()).toMatchObject({
      total: 270,
      pointsPersonal: 10,
      pointsGroup: 20,
      pointsGroupId: 'g1',
      pointsDiscount: 30,
      pointsApplied: 1,
    });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 30 });
    expect(db.prepare('SELECT points FROM ResearchGroup WHERE id = ?').get('g1')).toEqual({ points: 80 });
  });

  it('previews the new payable without writing points or coupons', async () => {
    const db = getTestDb();
    seedCoupon(db, { code: 'SAVE10' });
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-preview');
    asUser(buyer);
    const response = await preview(created.id, { personalPoints: 40, couponCode: 'SAVE10' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 250, pointsDiscount: 40, couponCode: 'SAVE10' });
    expect(orderRow()).toMatchObject({ total: 300, pointsPersonal: 0, pointsApplied: 0 });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 40 });
    expect(db.prepare('SELECT status FROM CouponInstance WHERE code = ?').get('SAVE10')).toEqual({ status: 'active' });
  });

  it('supersedes an active Alipay attempt when the payable cents change', async () => {
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-attempt');
    const db = getTestDb();
    db.prepare(`
      INSERT INTO PaymentAttempt (id, orderId, provider, outTradeNo, amount, status, createdAt, updatedAt)
      VALUES ('attempt-old', ?, 'alipay', 'LPOLD', 300, 'created', datetime('now'), datetime('now'))
    `).run(created.id);
    asUser(buyer);
    expect((await settle(created.id, { personalPoints: 40 })).status).toBe(200);
    expect(orderRow().total).toBe(260);
    expect(db.prepare('SELECT status, amount FROM PaymentAttempt WHERE id = ?').get('attempt-old')).toEqual({
      status: 'superseded',
      amount: 300,
    });
  });

  it('leaves an active Alipay attempt when the payable cents stay the same', async () => {
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-attempt-same');
    const db = getTestDb();
    db.prepare(`
      INSERT INTO PaymentAttempt (id, orderId, provider, outTradeNo, amount, status, createdAt, updatedAt)
      VALUES ('attempt-same', ?, 'alipay', 'LPSAME', 260, 'created', datetime('now'), datetime('now'))
    `).run(created.id);
    asUser(buyer);
    expect((await settle(created.id, { personalPoints: 40 })).status).toBe(200);
    expect(db.prepare('SELECT status FROM PaymentAttempt WHERE id = ?').get('attempt-same')).toEqual({ status: 'created' });
  });

  it('marks only proxy-accepted unpaid orders as eligible on the order detail', async () => {
    const proxy = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-get');
    asUser(buyer);
    const response = await orderGET(new NextRequest(`http://localhost:3000/api/orders/${proxy.id}`), {
      params: Promise.resolve({ id: proxy.id }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ownerPrepaySettlement: { eligible: true, couponCode: null, personalPoints: 0, groupPoints: 0 },
    });

    clearAllTables(getTestDb());
    seedAdmin(getTestDb());
    seedUser(getTestDb(), { id: 'buyer_points', email: 'q@test.com', name: '询价人', points: 40, role: 'customer' });
    seedInquiry(getTestDb());
    const self = await acceptQuote(buyer, { paymentMethod: 'alipay', personalPoints: 10 }, 'self-get');
    asUser(buyer);
    const selfResponse = await orderGET(new NextRequest(`http://localhost:3000/api/orders/${self.id}`), {
      params: Promise.resolve({ id: self.id }),
    });
    expect(selfResponse.status).toBe(200);
    expect((await selfResponse.json()).ownerPrepaySettlement.eligible).toBe(false);
  });

  it('keeps campaign adjustments and recalculates third-party fees and receivables', async () => {
    const db = getTestDb();
    const alipay = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-campaign');
    db.prepare(`
      INSERT INTO OrderAdjustment (id, orderId, type, label, amount, createdAt)
      VALUES ('adj-stack', ?, 'stack-discount', '活动', -20, datetime('now'))
    `).run(alipay.id);
    asUser(buyer);
    expect((await settle(alipay.id, { personalPoints: 10 })).status).toBe(200);
    expect(orderRow()).toMatchObject({ subtotal: 300, total: 270, pointsPersonal: 10 });
    expect(db.prepare(`SELECT type, amount FROM OrderAdjustment WHERE type = 'stack-discount'`).get()).toEqual({
      type: 'stack-discount',
      amount: -20,
    });

    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'buyer_points', email: 'q@test.com', name: '询价人', points: 40, role: 'customer' });
    seedInquiry(db);
    seedCoupon(db, { code: 'SAVE10' });
    const casmart = await acceptQuote(admin, { paymentMethod: 'casmart' }, 'proxy-casmart');
    expect(casmart.total).toBe(326);
    asUser(buyer);
    expect((await settle(casmart.id, { couponCode: 'SAVE10' })).status).toBe(200);
    expect(orderRow().total).toBe(315.8);
    expect(db.prepare(`SELECT type, amount FROM OrderAdjustment WHERE orderId = ? ORDER BY type`).all(casmart.id)).toEqual([
      { type: 'coupon', amount: -10 },
      { type: 'platform_fee', amount: 5.8 },
      { type: 'transfer_fee', amount: 20 },
    ]);

    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'buyer_points', email: 'q@test.com', name: '询价人', points: 40, role: 'customer' });
    seedInquiry(db);
    const bank = await acceptQuote(admin, { paymentMethod: 'bank_transfer' }, 'proxy-bank');
    expect(bank).toMatchObject({ total: 300, status: 'pending' });
    db.prepare(`
      INSERT INTO CreditAccount (id, userId, baseLimit, usedAmount, status, updatedAt)
      VALUES ('credit-1', 'buyer_points', 100000, 300, 'active', datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO AccountReceivable (id, orderId, userId, amount, status, confirmedAt, updatedAt)
      VALUES ('recv-1', ?, 'buyer_points', 300, 'open', datetime('now'), datetime('now'))
    `).run(bank.id);
    asUser(buyer);
    expect((await settle(bank.id, { personalPoints: 40 })).status).toBe(200);
    expect(orderRow().total).toBe(260);
    expect(db.prepare('SELECT amount, status FROM AccountReceivable WHERE orderId = ?').get(bank.id)).toEqual({
      amount: 260,
      status: 'open',
    });
    expect(db.prepare('SELECT usedAmount FROM CreditAccount WHERE userId = ?').get('buyer_points')).toEqual({ usedAmount: 260 });
  });

  it('rejects a non-string coupon code and a different customer', async () => {
    const created = await acceptQuote(admin, { paymentMethod: 'alipay' }, 'proxy-auth');
    asUser(buyer);
    const invalid = await settle(created.id, { couponCode: 12 });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: '优惠券码无效' });

    seedUser(getTestDb(), { id: 'other', email: 'other@test.com', role: 'customer', points: 100 });
    asUser({ id: 'other', email: 'other@test.com', role: 'customer' });
    const foreign = await settle(created.id, { personalPoints: 10 });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ code: 'ORDER_OWNER_REQUIRED' });
    expect(orderRow().total).toBe(300);
  });
});
