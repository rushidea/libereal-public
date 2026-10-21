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

const TERMINAL_STATUSES = ['cancelled', 'closed', 'shipped', 'completed', 'partially_shipped', 'confirmed'] as const;

function quoteRequest(id: string) {
  return new NextRequest(`http://localhost:3000/api/orders/${id}/quote`, { method: 'POST' });
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

async function postQuote(id = 'o1') {
  return quotePOST(quoteRequest(id), { params: Promise.resolve({ id }) });
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
    seedUser(db, { id: 'buyer_1', email: 'buyer@test.com', tier: '璞玉' });
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
    const confirmed = await postQuote();
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

    const response = await postQuote();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(orderRow()).toEqual({ status: 'confirmed', quoteSent: 1 });
    expect(await prisma.orderStatusHistory.findFirst()).toMatchObject({
      fromStatus: 'pending',
      toStatus: 'confirmed',
      reason: 'quote_sent',
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

    const response = await postQuote();

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

    const response = await postQuote();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'INSUFFICIENT_AVAILABLE_INVENTORY' });
    expect(orderRow()).toEqual({ status: 'pending', quoteSent: 0 });
    expect(await prisma.inventoryReservation.count()).toBe(0);
    expect(await prisma.accountReceivable.count()).toBe(0);
    expect(await prisma.creditAccount.findUnique({ where: { userId: 'buyer_1' } })).toBeNull();
  });

  it('returns 404 when the order does not exist', async () => {
    const response = await postQuote('missing');
    expect(response.status).toBe(404);
  });
});
