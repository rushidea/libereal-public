import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { releaseOrderInventory } from '@/lib/inventory';
import { releaseOrderReceivableOnCancellation } from '@/lib/customer-credit';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));

import { POST as quotePOST } from '@/app/api/orders/[id]/quote/route';
import { GET as adminOrderGET, PATCH as adminOrderPATCH } from '@/app/api/admin/orders/[id]/route';
import { PATCH as legacyOrderPATCH } from '@/app/api/orders/[id]/route';

const TERMINAL_STATUSES = ['cancelled', 'closed', 'shipped', 'completed', 'partially_shipped', 'confirmed'] as const;

function quoteRequest(id: string, body?: object) {
  return new NextRequest(`http://localhost:3000/api/orders/${id}/quote`, { method: 'POST',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
}

async function displayedApproval(id = 'o1') {
  const response = await adminOrderGET(new NextRequest(`http://localhost:3000/api/admin/orders/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  return (await response.json()).order.approvalPreview;
}

const acceptancePaths = ['admin PATCH', 'legacy PATCH', 'quote POST'] as const;

function submitAcceptance(path: (typeof acceptancePaths)[number], approvalVersion?: string, extra: object = {}) {
  const id = 'o1';
  const body = { status: 'confirmed', action: 'accept_order', approvalVersion, ...extra };
  if (path === 'quote POST') return postQuote(id, body);
  const req = new NextRequest(`http://localhost:3000/api/orders/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return (path === 'admin PATCH' ? adminOrderPATCH : legacyOrderPATCH)(req, { params: Promise.resolve({ id }) });
}

function seedCatalog(stockQuantity: number) {
  getTestDb().prepare(`
    INSERT INTO Product (id, catalogNumber, name, brand, price, stockQuantity, applications, reactivity, createdAt, updatedAt)
    VALUES ('p1', 'p1', '产品A', '测试品牌', 100, ?, '[]', '[]', datetime('now'), datetime('now'))
  `).run(stockQuantity);
}

function seedOrder(input: {
  id?: string;
  status?: string;
  paymentMethod?: string | null;
  paidAt?: string | null;
  total?: number;
  quantity?: number;
}) {
  const id = input.id ?? 'o1';
  const total = input.total ?? 200;
  const quantity = input.quantity ?? 2;
  getTestDb().prepare(`
    INSERT INTO "Order" (
      id, email, customerId, subtotal, total, status, paymentMethod, shippingMethod,
      operationLogs, createdAt, updatedAt, paidAt, quoteSent
    ) VALUES (?, 'buyer@test.com', 'buyer_1', ?, ?, ?, ?, 'logistics', '[]', datetime('now'), datetime('now'), ?, 0)
  `).run(id, total, total, input.status ?? 'pending', input.paymentMethod ?? 'bank_transfer', input.paidAt ?? null);
  getTestDb().prepare(`
    INSERT INTO OrderItem (id, orderId, position, productId, name, unitPrice, quantity, shippedQty, status, createdAt, updatedAt)
    VALUES (?, ?, 0, 'p1', '产品A', 100, ?, 0, 'pending', datetime('now'), datetime('now'))
  `).run(`${id}_item`, id, quantity);
}

async function postQuote(id = 'o1', body?: object) {
  return quotePOST(quoteRequest(id, body), { params: Promise.resolve({ id }) });
}

function orderRow(id = 'o1') {
  return getTestDb().prepare('SELECT status, quoteSent FROM "Order" WHERE id = ?').get(id) as { status: string; quoteSent: number };
}

describe('POST /api/orders/[id]/quote', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'buyer_1', email: 'buyer@test.com', tier: 'standard' });
    db.prepare(`
      INSERT INTO CreditAccount (id, userId, baseLimit, usedAmount, status, updatedAt)
      VALUES ('credit-buyer', 'buyer_1', 100000, 0, 'active', datetime('now'))
    `).run();
    seedCatalog(10);
  });

  it.each(TERMINAL_STATUSES)('rejects a %s order and leaves its status unchanged', async (status) => {
    seedOrder({ status, paymentMethod: 'bank_transfer' });

    const response = await postQuote();

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain('不能确认报价');
    expect(orderRow()).toEqual({ status, quoteSent: 0 });
    expect(await prisma.inventoryReservation.count()).toBe(0);
    expect(await prisma.accountReceivable.count()).toBe(0);
    expect(await prisma.orderStatusHistory.count()).toBe(0);
  });

  it('does not revive a cancelled order that already released inventory and credit', async () => {
    seedOrder({ status: 'pending', paymentMethod: 'bank_transfer', total: 200, quantity: 2 });
    const confirmed = await postQuote('o1', { approvalVersion: (await displayedApproval()).version });
    expect(confirmed.status).toBe(200);
    expect(await prisma.inventoryAccount.findFirst()).toMatchObject({ reservedQuantity: 2, availableQuantity: 8 });
    expect(await prisma.creditAccount.findUnique({ where: { userId: 'buyer_1' } })).toMatchObject({ usedAmount: 200 });

    await prisma.$transaction(async (tx) => {
      await releaseOrderInventory(tx, 'o1', 'admin_test_id');
      await releaseOrderReceivableOnCancellation(tx, 'o1', 'admin_test_id');
      await tx.order.update({ where: { id: 'o1' }, data: { status: 'cancelled' } });
    });
    const before = getTestDb().prepare('SELECT status, quoteSent, quoteSentAt FROM "Order" WHERE id = ?').get('o1') as {
      status: string;
      quoteSent: number;
      quoteSentAt: string | null;
    };

    const revived = await postQuote();

    expect(revived.status).toBe(409);
    await expect(revived.json()).resolves.toEqual({ error: '订单当前状态为已取消，不能确认报价。' });
    expect(getTestDb().prepare('SELECT status, quoteSent, quoteSentAt FROM "Order" WHERE id = ?').get('o1')).toEqual(before);
    expect(await prisma.inventoryAccount.findFirst()).toMatchObject({ reservedQuantity: 0, availableQuantity: 10 });
    expect(await prisma.inventoryReservation.findFirst()).toMatchObject({ status: 'released' });
    expect(await prisma.creditAccount.findUnique({ where: { userId: 'buyer_1' } })).toMatchObject({ usedAmount: 0 });
    expect(await prisma.accountReceivable.findUnique({ where: { orderId: 'o1' } })).toMatchObject({ status: 'cancelled' });
    expect(await prisma.orderStatusHistory.count({ where: { toStatus: 'confirmed' } })).toBe(1);
  });

  it('confirms a pending post-delivery order and reserves product inventory and credit', async () => {
    seedOrder({ status: 'pending', paymentMethod: 'bank_transfer', total: 200, quantity: 2 });

    const approval = await displayedApproval();
    const response = await postQuote('o1', { approvalVersion: approval.version });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(orderRow()).toEqual({ status: 'confirmed', quoteSent: 1 });
    const history = await prisma.orderStatusHistory.findFirstOrThrow();
    expect(history).toMatchObject({
      fromStatus: 'pending', toStatus: 'confirmed', reason: 'quote_sent', actorId: 'admin_test_id',
    });
    expect(JSON.parse(history.metadata!)).toMatchObject({
      action: 'accept_order', actorType: 'libereal_admin', version: 2, orderVersion: approval.version, snapshot: approval.snapshot,
    });
    expect(await prisma.inventoryAccount.findFirst()).toMatchObject({
      variantId: null,
      actualQuantity: 10,
      reservedQuantity: 2,
      availableQuantity: 8,
    });
    expect(await prisma.inventoryReservation.findFirst()).toMatchObject({ status: 'active', quantity: 2 });
    expect(await prisma.creditAccount.findUnique({ where: { userId: 'buyer_1' } })).toMatchObject({ usedAmount: 200 });
    expect(await prisma.accountReceivable.findUnique({ where: { orderId: 'o1' } })).toMatchObject({ status: 'open', amount: 200 });
  });

  it('confirms a paid Alipay order that is pending and reserves inventory without credit', async () => {
    seedOrder({ status: 'pending', paymentMethod: 'alipay', paidAt: new Date().toISOString(), total: 200, quantity: 2 });

    const response = await postQuote('o1', { approvalVersion: (await displayedApproval()).version });

    expect(response.status).toBe(200);
    expect(orderRow()).toEqual({ status: 'confirmed', quoteSent: 1 });
    expect(await prisma.inventoryReservation.count()).toBe(1);
    expect(await prisma.accountReceivable.count()).toBe(0);
  });

  it('sends a quote for an unpaid order without confirming or reserving stock', async () => {
    seedOrder({ status: 'unpaid', paymentMethod: 'alipay', total: 200, quantity: 2 });

    const response = await postQuote();

    expect(response.status).toBe(200);
    expect(orderRow()).toEqual({ status: 'unpaid', quoteSent: 1 });
    expect(await prisma.inventoryReservation.count()).toBe(0);
    expect(await prisma.accountReceivable.count()).toBe(0);
    expect(await prisma.orderStatusHistory.count()).toBe(0);
  });

  it('rejects confirming an unpaid but already paid Alipay order', async () => {
    seedOrder({ status: 'unpaid', paymentMethod: 'alipay', paidAt: new Date().toISOString() });

    const response = await postQuote();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: '未付款订单不能直接确认为已确认。' });
    expect(orderRow()).toEqual({ status: 'unpaid', quoteSent: 0 });
    expect(await prisma.inventoryReservation.count()).toBe(0);
  });

  it('rolls back confirmation when product inventory is insufficient', async () => {
    getTestDb().prepare(`UPDATE Product SET stockQuantity = 1 WHERE id = 'p1'`).run();
    seedOrder({ status: 'pending', paymentMethod: 'bank_transfer', quantity: 2, total: 200 });

    const response = await postQuote('o1', { approvalVersion: (await displayedApproval()).version });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'INSUFFICIENT_AVAILABLE_INVENTORY' });
    expect(orderRow()).toEqual({ status: 'pending', quoteSent: 0 });
    expect(await prisma.inventoryReservation.count()).toBe(0);
    expect(await prisma.accountReceivable.count()).toBe(0);
    expect(await prisma.creditAccount.findUnique({ where: { userId: 'buyer_1' } })).toMatchObject({ usedAmount: 0 });
  });

  it.each(acceptancePaths)('%s rejects missing and changed approvals before committing a single current version', async (path) => {
    seedOrder({});
    const missing = await submitAcceptance(path);
    expect(missing.status).toBe(409);
    await expect(missing.json()).resolves.toMatchObject({ code: 'ORDER_APPROVAL_PREVIEW_REQUIRED' });

    const original = await displayedApproval();
    await prisma.orderItem.update({ where: { id: 'o1_item' }, data: { quantity: 3, unitPrice: 80 } });
    await prisma.order.update({ where: { id: 'o1' }, data: { subtotal: 240, total: 240 } });
    const staleLines = await submitAcceptance(path, original.version);
    expect(staleLines.status).toBe(409);
    await expect(staleLines.json()).resolves.toMatchObject({ code: 'ORDER_APPROVAL_CHANGED' });

    const beforeCreditChange = await displayedApproval();
    await prisma.creditAccount.update({ where: { userId: 'buyer_1' }, data: { paymentTermDays: 45 } });
    const staleCredit = await submitAcceptance(path, beforeCreditChange.version);
    expect(staleCredit.status).toBe(409);
    await expect(staleCredit.json()).resolves.toMatchObject({ code: 'ORDER_APPROVAL_CHANGED' });
    expect(orderRow()).toEqual({ status: 'pending', quoteSent: 0 });
    expect(await prisma.orderStatusHistory.count()).toBe(0);
    expect(await prisma.accountReceivable.count()).toBe(0);
    expect(await prisma.inventoryReservation.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);

    const latest = await displayedApproval();
    expect(latest.snapshot).toMatchObject({
      customerEmail: 'buyer@test.com', total: 240, credit: { debtorId: 'buyer_1', paymentTermDays: 45 },
      lines: [{ quantity: 3, unitPrice: 80 }],
    });
    expect((await submitAcceptance(path, latest.version)).status).toBe(200);
    expect((await submitAcceptance(path, latest.version)).status).toBe(409);
    const history = await prisma.orderStatusHistory.findFirstOrThrow();
    expect(JSON.parse(history.metadata!)).toMatchObject({ orderVersion: latest.version, snapshot: latest.snapshot });
    expect(await prisma.orderStatusHistory.count()).toBe(1);
    expect(await prisma.accountReceivable.findFirst()).toMatchObject({ amount: 240, paymentTermDaysSnapshot: 45 });
    expect(await prisma.inventoryReservation.count()).toBe(1);
  });

  it('commits one acceptance when different endpoints race with the same preview', async () => {
    seedOrder({});
    const approval = await displayedApproval();
    const attempts = await Promise.all([
      submitAcceptance('admin PATCH', approval.version),
      submitAcceptance('quote POST', approval.version),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: 'o1', toStatus: 'confirmed' } })).toBe(1);
    expect(await prisma.accountReceivable.count()).toBe(1);
    expect(await prisma.creditTransaction.count()).toBe(1);
    expect(await prisma.inventoryReservation.count()).toBe(1);
  });

  it('requires saving a payment edit before an administrator can approve the new terms', async () => {
    seedOrder({});
    const current = await displayedApproval();
    const response = await submitAcceptance('legacy PATCH', current.version, { paymentMethod: 'rjmart' });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'ORDER_APPROVAL_SAVE_CHANGES_FIRST' });
    expect(await prisma.order.findUnique({ where: { id: 'o1' } })).toMatchObject({ status: 'pending', paymentMethod: 'bank_transfer' });
    expect(await prisma.orderStatusHistory.count()).toBe(0);
  });

  it('keeps sending a quote and accepting a later paid order as distinct actions', async () => {
    seedOrder({ status: 'pending', paymentMethod: 'alipay' });
    const initial = await displayedApproval();
    expect(initial.action).toBe('send_quote');
    expect((await postQuote('o1', { action: 'send_quote', approvalVersion: initial.version })).status).toBe(200);
    expect(orderRow()).toEqual({ status: 'pending', quoteSent: 1 });
    expect(await prisma.orderStatusHistory.count()).toBe(0);

    await prisma.order.update({ where: { id: 'o1' }, data: { paidAt: new Date() } });
    const stale = await postQuote('o1', { action: 'send_quote', approvalVersion: initial.version });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: 'ORDER_APPROVAL_CHANGED' });
    const oldConsumer = await postQuote();
    expect(oldConsumer.status).toBe(409);
    await expect(oldConsumer.json()).resolves.toMatchObject({ code: 'ORDER_APPROVAL_PREVIEW_REQUIRED' });
    expect(orderRow()).toEqual({ status: 'pending', quoteSent: 1 });

    expect((await submitAcceptance('quote POST', (await displayedApproval()).version)).status).toBe(200);
    expect(orderRow()).toEqual({ status: 'confirmed', quoteSent: 1 });
    expect(await prisma.notification.count()).toBe(2);
    expect((await prisma.backgroundTask.findMany({ select: { dedupeKey: true } })).map((task) => task.dedupeKey))
      .toEqual(expect.arrayContaining(['order-quote-email:o1', 'order-acceptance-email:o1']));
  });

  it('returns 404 when the order does not exist', async () => {
    const response = await postQuote('missing');
    expect(response.status).toBe(404);
  });
});
