import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';
import { getEphemeralStore } from '@/lib/ephemeral-store';

const authMock = vi.hoisted(() => vi.fn());
const tierFixture = vi.hoisted(() => [
  { level: 1, min: 0, name: '璞玉', creditLimit: 5000, discountRate: 0.995 },
  { level: 2, min: 40000, name: '岫岩玉', creditLimit: 10000, discountRate: 0.99 },
]);

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => authMock(...args),
}));

vi.mock('@/lib/discount', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/discount')>();
  return {
    ...actual,
    TIERS: tierFixture,
    TIER_DISCOUNT_RATES: { 璞玉: 0.995, 岫岩玉: 0.99 },
    getTierByRollingSpend: (amount: number, tiers = tierFixture) =>
      [...tiers].sort((a, b) => b.min - a.min).find((tier) => amount >= tier.min) ?? actual.DEFAULT_TIER,
  };
});

vi.mock('@/lib/organization-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/organization-service')>();
  return {
    ...actual,
    listOrganizationIdsForPermission: async () => [],
    listActiveOrganizationIdsForUser: async () => [],
  };
});

import { POST as quotePOST } from '@/app/api/inquiries/[id]/quote/route';
import { POST as confirmQuotePOST } from '@/app/api/orders/[id]/confirm-items/route';
import { GET as ordersListGET } from '@/app/api/orders/route';
import { GET as orderDetailGET, PATCH as customerOrAdminOrderPATCH } from '@/app/api/orders/[id]/route';
import { POST as orderQuotePOST } from '@/app/api/orders/[id]/quote/route';
import { GET as adminOrdersGET } from '@/app/api/admin/orders/route';
import { GET as adminOrderDetailGET, PATCH as adminOrderPATCH } from '@/app/api/admin/orders/[id]/route';
import { GET as adminUsersGET } from '@/app/api/users/route';
import { PATCH as creditPATCH } from '@/app/api/admin/users/[id]/credit/route';

const adminUser = { id: 'admin_test_id', email: 'admin@test.com', role: 'admin' as const };
const buyerUser = { id: 'buyer_credit', email: '61216888@qq.com', role: 'customer' as const };

function asUser(user: { id: string; email: string; role: 'admin' | 'customer' }, sessionId = `session-${user.id}`) {
  authMock.mockResolvedValue({
    user: {
      id: user.id,
      email: user.email,
      name: user.role === 'admin' ? 'Admin' : 'Realgent',
      role: user.role,
      sessionId,
    },
  });
}

function seedInquiryForCredit(db: ReturnType<typeof getTestDb>, inquiryId = 'INQ-CREDIT-1') {
  db.prepare(`
    INSERT OR IGNORE INTO Product (id, catalogNumber, name, brand, price, stockQuantity, applications, reactivity, createdAt, updatedAt)
    VALUES ('p1', 'CAT-1', '测试抗体', '测试品牌', 13230, -1, '[]', '[]', datetime('now'), datetime('now'))
  `).run();
  db.prepare(`
    INSERT INTO Inquiry (id, userId, name, email, phone, institution, paymentMethod, status, createdAt, operationLogs)
    VALUES (?, ?, 'Realgent', ?, '13800000000', '测试高校', 'rjmart', 'pending_quote', datetime('now'), '[]')
  `).run(inquiryId, buyerUser.id, buyerUser.email);
  db.prepare(`
    INSERT INTO InquiryItem (id, inquiryId, position, productId, name, unitPrice, quantity, lineTotal, createdAt, updatedAt)
    VALUES (?, ?, 0, 'p1', '测试抗体', 13230, 1, 13230, datetime('now'), datetime('now'))
  `).run(`${inquiryId}_item_0`, inquiryId);
}

async function publishQuoteAndAccept(inquiryId: string, attemptId: string, price = 13230) {
  asUser(adminUser);
  const quoteRes = await quotePOST(
    new NextRequest(`http://localhost:3000/api/inquiries/${inquiryId}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: 'p1', name: '测试抗体', price, quantity: 1 }],
        confirmWarnings: true,
      }),
    }),
    { params: Promise.resolve({ id: inquiryId }) },
  );
  expect(quoteRes.status).toBe(200);
  const quote = getTestDb().prepare('SELECT id, version FROM Quote WHERE inquiryId = ? ORDER BY version DESC LIMIT 1').get(inquiryId) as { id: string; version: number };

  asUser(buyerUser);
  return confirmQuotePOST(
    new NextRequest(`http://localhost:3000/api/orders/${inquiryId}/confirm-items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemIndices: [0],
        quantities: { 0: 1 },
        quoteId: quote.id,
        quoteVersion: quote.version,
        acceptanceAttemptId: attemptId,
        paymentMethod: 'rjmart',
      }),
    }),
    { params: Promise.resolve({ id: inquiryId }) },
  );
}

describe('B2 Direction 2 over-credit manual review & credit entry flow', () => {
  const previousMfaAdminRequired = process.env.MFA_ADMIN_REQUIRED;

  beforeAll(() => {
    getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: buyerUser.id, email: buyerUser.email, name: 'Realgent', tier: '璞玉', role: 'customer' });
    delete process.env.MFA_ADMIN_REQUIRED;
  });

  afterEach(() => {
    if (previousMfaAdminRequired === undefined) delete process.env.MFA_ADMIN_REQUIRED;
    else process.env.MFA_ADMIN_REQUIRED = previousMfaAdminRequired;
  });

  it('allows over-credit post-delivery quote acceptance as pending review, enforces hard block on confirm, then succeeds after limit raise', async () => {
    const db = getTestDb();
    seedInquiryForCredit(db, 'INQ-CREDIT-1');

    // 1. User list reflects real tier default credit (¥5,000), never ¥0
    asUser(adminUser);
    const usersRes = await adminUsersGET();
    expect(usersRes.status).toBe(200);
    const usersList = await usersRes.json() as Array<{ id: string; creditSummary?: { tierDefaultLimit: number; effectiveLimit: number; availableAmount: number; hasAccount: boolean } }>;
    const buyerRow = usersList.find((u) => u.id === buyerUser.id);
    expect(buyerRow?.creditSummary).toMatchObject({
      tierDefaultLimit: 5000,
      effectiveLimit: 5000,
      availableAmount: 5000,
      hasAccount: false,
    });

    // 2. Customer accepts ¥13,230 quote with rjmart while credit limit is ¥5,000 -> pending manual review
    const acceptRes = await publishQuoteAndAccept('INQ-CREDIT-1', 'attempt-over-credit-1', 13230);
    expect(acceptRes.status).toBe(200);
    const acceptBody = await acceptRes.json() as {
      orderId: string;
      creditReviewRequired: boolean;
      creditReview: { availableAmount: number; effectiveLimit: number; orderTotal: number; shortfall: number };
      order: { status: string };
    };
    expect(acceptBody.creditReviewRequired).toBe(true);
    expect(acceptBody.order.status).toBe('pending');
    expect(acceptBody.creditReview).toMatchObject({
      availableAmount: 5000,
      effectiveLimit: 5000,
      orderTotal: 13230,
      shortfall: 8230,
    });

    const orderId = acceptBody.orderId;
    // Zero credit occupied and zero receivables until admin accepts the order
    expect(db.prepare('SELECT COUNT(*) AS count FROM AccountReceivable').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM CreditAccount').get()).toEqual({ count: 0 });
    const events = db.prepare('SELECT type, message, metadata FROM OrderEvent WHERE orderId = ? ORDER BY createdAt ASC').all(orderId) as Array<{ type: string; message: string; metadata: string }>;
    expect(events.map((e) => e.type)).toEqual(['order_created', 'credit_review_required']);
    expect(JSON.parse(events[1].metadata)).toMatchObject({ shortfall: 8230, availableAmount: 5000 });
    expect(db.prepare('SELECT type, title FROM Notification WHERE role = ?').all('admin')).toContainEqual({
      type: 'order_credit_review_required',
      title: '超授信待审订单',
    });

    // 3. Customer GET /api/orders & GET /api/orders/[id] surface creditReviewPending
    asUser(buyerUser);
    const myListRes = await ordersListGET(new NextRequest('http://localhost:3000/api/orders'));
    expect(myListRes.status).toBe(200);
    const myList = await myListRes.json() as Array<{ id: string; creditReviewPending?: boolean }>;
    expect(myList.find((o) => o.id === orderId)?.creditReviewPending).toBe(true);

    const myDetailRes = await orderDetailGET(new NextRequest(`http://localhost:3000/api/orders/${orderId}`), {
      params: Promise.resolve({ id: orderId }),
    });
    expect(myDetailRes.status).toBe(200);
    expect((await myDetailRes.json() as { creditReviewPending?: boolean }).creditReviewPending).toBe(true);

    // 4. Admin list & detail APIs report live shortfall
    asUser(adminUser);
    const adminListRes = await adminOrdersGET(new NextRequest('http://localhost:3000/api/admin/orders?page=1&pageSize=20'));
    expect(adminListRes.status).toBe(200);
    const adminListBody = await adminListRes.json() as { orders: Array<{ id: string; creditReview?: { needsReview: boolean; shortfall: number } }> };
    expect(adminListBody.orders.find((o) => o.id === orderId)?.creditReview).toMatchObject({
      needsReview: true,
      shortfall: 8230,
    });

    const adminDetailBeforeRes = await adminOrderDetailGET(new NextRequest(`http://localhost:3000/api/admin/orders/${orderId}`), {
      params: Promise.resolve({ id: orderId }),
    });
    expect(adminDetailBeforeRes.status).toBe(200);
    const adminDetailBefore = (await adminDetailBeforeRes.json() as { order: { creditReview: { needsReview: boolean; flaggedAtSubmission: boolean; shortfall: number; summary: { tierDefaultLimit: number; effectiveLimit: number } } } }).order;
    expect(adminDetailBefore.creditReview).toMatchObject({
      needsReview: true,
      flaggedAtSubmission: true,
      shortfall: 8230,
      summary: { tierDefaultLimit: 5000, effectiveLimit: 5000 },
    });

    // 5. All three admin confirm endpoints hard-reject over-credit order with CREDIT_LIMIT_EXCEEDED
    const patchAdminRes = await adminOrderPATCH(
      new NextRequest(`http://localhost:3000/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(patchAdminRes.status).toBe(409);
    expect(await patchAdminRes.json()).toEqual({ error: 'CREDIT_LIMIT_EXCEEDED' });

    const patchOrderRes = await customerOrAdminOrderPATCH(
      new NextRequest(`http://localhost:3000/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(patchOrderRes.status).toBe(409);
    expect(await patchOrderRes.json()).toEqual({ error: 'CREDIT_LIMIT_EXCEEDED' });

    const quoteConfirmRes = await orderQuotePOST(
      new NextRequest(`http://localhost:3000/api/orders/${orderId}/quote`, { method: 'POST' }),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(quoteConfirmRes.status).toBe(409);
    expect(await quoteConfirmRes.json()).toEqual({ error: 'CREDIT_LIMIT_EXCEEDED' });
    expect(db.prepare('SELECT status FROM "Order" WHERE id = ?').get(orderId)).toEqual({ status: 'pending' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM AccountReceivable').get()).toEqual({ count: 0 });

    // 6. Credit PATCH validation: temp limit without expiry rejected; Shanghai expiry parsed cleanly
    const missingExpiryRes = await creditPATCH(
      new NextRequest(`http://localhost:3000/api/admin/users/${buyerUser.id}/credit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temporaryLimit: 9000, temporaryUntil: null }),
      }),
      { params: Promise.resolve({ id: buyerUser.id }) },
    );
    expect(missingExpiryRes.status).toBe(400);
    expect(await missingExpiryRes.json()).toMatchObject({ error: '设置临时额度时必须填写到期日' });

    const badDateRes = await creditPATCH(
      new NextRequest(`http://localhost:3000/api/admin/users/${buyerUser.id}/credit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temporaryLimit: 9000, temporaryUntil: '2026-02-31' }),
      }),
      { params: Promise.resolve({ id: buyerUser.id }) },
    );
    expect(badDateRes.status).toBe(400);

    const raiseTempRes = await creditPATCH(
      new NextRequest(`http://localhost:3000/api/admin/users/${buyerUser.id}/credit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temporaryLimit: 9000, temporaryUntil: '2099-12-01', reason: '单次临时调额' }),
      }),
      { params: Promise.resolve({ id: buyerUser.id }) },
    );
    expect(raiseTempRes.status).toBe(200);
    const raisedAccount = (await raiseTempRes.json() as { account: { effectiveLimit: number; temporaryUntil: string } }).account;
    expect(raisedAccount.effectiveLimit).toBe(14000);
    expect(raisedAccount.temporaryUntil).toBe('2099-12-01T15:59:59.999Z');

    // Resetting temporaryLimit to 0 clears leftover expiry
    const clearTempRes = await creditPATCH(
      new NextRequest(`http://localhost:3000/api/admin/users/${buyerUser.id}/credit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideLimit: 15000, temporaryLimit: 0, reason: '改调永久额度' }),
      }),
      { params: Promise.resolve({ id: buyerUser.id }) },
    );
    expect(clearTempRes.status).toBe(200);
    const clearedAccount = (await clearTempRes.json() as { account: { effectiveLimit: number; temporaryUntil: string | null } }).account;
    expect(clearedAccount.effectiveLimit).toBe(15000);
    expect(clearedAccount.temporaryUntil).toBeNull();

    // 7. Admin order detail now flips needsReview=false while retaining flaggedAtSubmission=true
    const adminDetailAfterRaiseRes = await adminOrderDetailGET(new NextRequest(`http://localhost:3000/api/admin/orders/${orderId}`), {
      params: Promise.resolve({ id: orderId }),
    });
    expect(adminDetailAfterRaiseRes.status).toBe(200);
    const adminDetailAfterRaise = (await adminDetailAfterRaiseRes.json() as { order: { creditReview: { needsReview: boolean; flaggedAtSubmission: boolean; shortfall: number; summary: { effectiveLimit: number; availableAmount: number } } } }).order;
    expect(adminDetailAfterRaise.creditReview).toMatchObject({
      needsReview: false,
      flaggedAtSubmission: true,
      shortfall: 0,
      summary: { effectiveLimit: 15000, availableAmount: 15000 },
    });

    // 8. Admin confirms the order -> reserves ¥13,230 credit and creates open AccountReceivable
    const confirmNowRes = await adminOrderPATCH(
      new NextRequest(`http://localhost:3000/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      { params: Promise.resolve({ id: orderId }) },
    );
    expect(confirmNowRes.status).toBe(200);
    expect(db.prepare('SELECT status FROM "Order" WHERE id = ?').get(orderId)).toEqual({ status: 'confirmed' });
    expect(db.prepare('SELECT usedAmount FROM CreditAccount WHERE userId = ?').get(buyerUser.id)).toEqual({ usedAmount: 13230 });
    expect(db.prepare('SELECT amount, status FROM AccountReceivable WHERE orderId = ?').get(orderId)).toEqual({ amount: 13230, status: 'open' });

    const adminDetailFinalRes = await adminOrderDetailGET(new NextRequest(`http://localhost:3000/api/admin/orders/${orderId}`), {
      params: Promise.resolve({ id: orderId }),
    });
    expect((await adminDetailFinalRes.json() as { order: { creditReview: unknown } }).order.creditReview).toBeNull();
  });

  it('hard-blocks paused or overdue_hold accounts at quote confirmation without creating an order', async () => {
    const db = getTestDb();
    seedInquiryForCredit(db, 'INQ-CREDIT-PAUSED');
    db.prepare(`
      INSERT INTO CreditAccount (id, userId, baseLimit, usedAmount, status, statusSource, updatedAt)
      VALUES ('cred-paused', ?, 5000, 0, 'paused', 'manual', datetime('now'))
    `).run(buyerUser.id);

    const res = await publishQuoteAndAccept('INQ-CREDIT-PAUSED', 'attempt-paused-1', 100);
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string; error: string };
    expect(body.code).toBe('CREDIT_ACCOUNT_SUSPENDED');
    expect(body.error).toContain('暂停');
    expect(db.prepare('SELECT COUNT(*) AS count FROM "Order"').get()).toEqual({ count: 0 });
  });

  it('consumes a single-use stepUpToken once for credit adjustment when MFA is required and rejects replay', async () => {
    process.env.MFA_ADMIN_REQUIRED = 'true';
    asUser(adminUser, 'sess-admin-mfa');

    // Without token or MFA-verified session -> 403 Admin MFA required
    const unverifiedRes = await creditPATCH(
      new NextRequest(`http://localhost:3000/api/admin/users/${buyerUser.id}/credit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideLimit: 20000 }),
      }),
      { params: Promise.resolve({ id: buyerUser.id }) },
    );
    expect(unverifiedRes.status).toBe(403);
    expect((await unverifiedRes.json() as { error: string }).error).toBe('Admin MFA required');

    // Issue a real scoped admin_sensitive grant token in TransientEntry store
    const token = 'single-use-credit-stepup-token';
    const secret = process.env.SECURITY_CODE_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? 'local-security-code-secret';
    const key = `security-step-up:grant:${createHmac('sha256', secret).update(token).digest('hex')}`;
    await getEphemeralStore().set(
      key,
      JSON.stringify({ userId: adminUser.id, sessionId: 'sess-admin-mfa', action: 'admin_sensitive' }),
      60_000,
    );

    const firstRes = await creditPATCH(
      new NextRequest(`http://localhost:3000/api/admin/users/${buyerUser.id}/credit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideLimit: 20000, stepUpToken: token }),
      }),
      { params: Promise.resolve({ id: buyerUser.id }) },
    );
    expect(firstRes.status).toBe(200);
    expect((await firstRes.json() as { account: { effectiveLimit: number } }).account.effectiveLimit).toBe(20000);

    // Replaying the same grant token fails closed with 403
    const replayRes = await creditPATCH(
      new NextRequest(`http://localhost:3000/api/admin/users/${buyerUser.id}/credit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideLimit: 25000, stepUpToken: token }),
      }),
      { params: Promise.resolve({ id: buyerUser.id }) },
    );
    expect(replayRes.status).toBe(403);
    expect((await replayRes.json() as { error: string }).error).toBe('Admin MFA required');

    // Validation error must NOT burn a fresh stepUpToken
    const reusableToken = 'reusable-before-validation-pass-token';
    const reusableKey = `security-step-up:grant:${createHmac('sha256', secret).update(reusableToken).digest('hex')}`;
    await getEphemeralStore().set(
      reusableKey,
      JSON.stringify({ userId: adminUser.id, sessionId: 'sess-admin-mfa', action: 'admin_sensitive' }),
      60_000,
    );
    const badTempRes = await creditPATCH(
      new NextRequest(`http://localhost:3000/api/admin/users/${buyerUser.id}/credit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temporaryLimit: 5000, temporaryUntil: null, stepUpToken: reusableToken }),
      }),
      { params: Promise.resolve({ id: buyerUser.id }) },
    );
    expect(badTempRes.status).toBe(400);

    // Same token remains valid for the corrected request (and temp=0 clears incoming temporaryUntil)
    const validAfter400Res = await creditPATCH(
      new NextRequest(`http://localhost:3000/api/admin/users/${buyerUser.id}/credit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temporaryLimit: 0, temporaryUntil: '2099-12-30', stepUpToken: reusableToken }),
      }),
      { params: Promise.resolve({ id: buyerUser.id }) },
    );
    expect(validAfter400Res.status).toBe(200);
    expect((await validAfter400Res.json() as { account: { temporaryUntil: string | null } }).account.temporaryUntil).toBeNull();
  });

  it('blocks clearing/confirming empty paymentMethod and handles cent rounding at limit boundary', async () => {
    const db = getTestDb();
    asUser(adminUser);

    // Order with null paymentMethod cannot be confirmed
    db.prepare(`
      INSERT INTO "Order" (id, email, customerId, subtotal, total, status, paymentMethod, shippingMethod, operationLogs, createdAt, updatedAt)
      VALUES ('ORD-NULL-PM', ?, ?, 100, 100, 'pending', NULL, 'logistics', '[]', datetime('now'), datetime('now'))
    `).run(buyerUser.email, buyerUser.id);
    const nullConfirmAdmin = await adminOrderPATCH(
      new NextRequest('http://localhost:3000/api/admin/orders/ORD-NULL-PM', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      { params: Promise.resolve({ id: 'ORD-NULL-PM' }) },
    );
    expect(nullConfirmAdmin.status).toBe(409);
    expect(await nullConfirmAdmin.json()).toEqual({ error: 'PAYMENT_METHOD_REQUIRED' });

    const nullConfirmOrder = await customerOrAdminOrderPATCH(
      new NextRequest('http://localhost:3000/api/orders/ORD-NULL-PM', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      { params: Promise.resolve({ id: 'ORD-NULL-PM' }) },
    );
    expect(nullConfirmOrder.status).toBe(409);
    expect(await nullConfirmOrder.json()).toEqual({ error: 'PAYMENT_METHOD_REQUIRED' });

    // Existing post-delivery paymentMethod cannot be cleared back to empty string
    db.prepare(`UPDATE "Order" SET paymentMethod = 'bank_transfer' WHERE id = 'ORD-NULL-PM'`).run();
    const clearPmRes = await customerOrAdminOrderPATCH(
      new NextRequest('http://localhost:3000/api/orders/ORD-NULL-PM', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethod: '' }),
      }),
      { params: Promise.resolve({ id: 'ORD-NULL-PM' }) },
    );
    expect(clearPmRes.status).toBe(400);
    expect(await clearPmRes.json()).toEqual({ error: 'PAYMENT_METHOD_REQUIRED' });

    // Binary float 100.1 + 200.2 = 300.30000000000007 vs limit 300.3 must confirm cleanly without false overflow
    db.prepare(`
      INSERT INTO CreditAccount (id, userId, baseLimit, overrideLimit, usedAmount, status, statusSource, updatedAt)
      VALUES ('cred-cents', ?, 5000, 300.3, 100.1, 'active', 'manual', datetime('now'))
    `).run(buyerUser.id);
    db.prepare(`
      INSERT INTO "Order" (id, email, customerId, subtotal, total, status, paymentMethod, shippingMethod, operationLogs, createdAt, updatedAt)
      VALUES ('ORD-CENTS', ?, ?, 200.2, 200.2, 'pending', 'rjmart', 'logistics', '[]', datetime('now'), datetime('now'))
    `).run(buyerUser.email, buyerUser.id);

    const centConfirmRes = await adminOrderPATCH(
      new NextRequest('http://localhost:3000/api/admin/orders/ORD-CENTS', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      }),
      { params: Promise.resolve({ id: 'ORD-CENTS' }) },
    );
    expect(centConfirmRes.status).toBe(200);
    expect(db.prepare('SELECT usedAmount FROM CreditAccount WHERE userId = ?').get(buyerUser.id)).toEqual({ usedAmount: 300.3 });
  });
});
