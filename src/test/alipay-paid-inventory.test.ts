import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { reserveOrderInventory } from '@/lib/inventory';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

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

function notify(outTradeNo: string, amount = '100.00') {
  const body = new URLSearchParams({
    app_id: '9021000000000000',
    seller_id: '2088000000000000',
    out_trade_no: outTradeNo,
    total_amount: amount,
    trade_status: 'TRADE_SUCCESS',
    trade_no: `trade-${outTradeNo}`,
    sign_type: 'RSA2',
    sign: 'signed-value',
  });
  return new Request('https://libereal.cn/api/payments/alipay/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

function seedOrder(id: string, outTradeNo: string, quantity: number, stockQuantity: number) {
  const db = getTestDb();
  db.prepare(`
    INSERT INTO Product (id, catalogNumber, name, brand, price, stockQuantity, applications, reactivity, createdAt, updatedAt)
    VALUES ('p1', 'CAT-1', '产品', 'CST', 100, ?, '[]', '[]', datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET stockQuantity = excluded.stockQuantity
  `).run(stockQuantity);
  db.prepare(`
    INSERT INTO "Order" (
      id, email, subtotal, total, status, paymentMethod, owner_scope, shippingMethod, operationLogs,
      createdAt, updatedAt
    ) VALUES (?, 'buyer@example.com', ?, ?, 'unpaid', 'alipay', 'personal', 'logistics', '[]', datetime('now'), datetime('now'))
  `).run(id, 100 * quantity, 100 * quantity);
  db.prepare(`
    INSERT INTO OrderItem (
      id, orderId, position, productId, name, unitPrice, quantity, shippedQty, status, createdAt, updatedAt
    ) VALUES (?, ?, 0, 'p1', '产品', 100, ?, 0, 'pending', datetime('now'), datetime('now'))
  `).run(`${id}-item`, id, quantity);
  db.prepare(`
    INSERT INTO PaymentAttempt (id, orderId, provider, outTradeNo, amount, status, createdAt, updatedAt)
    VALUES (?, ?, 'alipay', ?, ?, 'redirected', datetime('now'), datetime('now'))
  `).run(`${id}-attempt`, id, outTradeNo, 100 * quantity);
}

describe('Alipay payment inventory reservation', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => { clearAllTables(getTestDb()); });

  it('reserves the paid quantity once and leaves a later payment unpaid when stock is short', async () => {
    seedOrder('order-a', 'LP-A', 1, 1);
    seedOrder('order-b', 'LP-B', 1, 1);

    const first = await POST(notify('LP-A'));
    expect(first.status).toBe(200);
    await expect(first.text()).resolves.toBe('success');

    const paid = await prisma.order.findUnique({ where: { id: 'order-a' }, select: { status: true, paidAt: true } });
    expect(paid?.status).toBe('pending');
    expect(paid?.paidAt).toBeTruthy();
    expect(await prisma.inventoryAccount.findFirst()).toMatchObject({
      actualQuantity: 1,
      reservedQuantity: 1,
      availableQuantity: 0,
    });
    expect(await prisma.product.findUnique({ where: { id: 'p1' }, select: { stockQuantity: true } })).toEqual({ stockQuantity: 0 });

    const second = await POST(notify('LP-B'));
    expect(second.status).toBe(200);
    await expect(second.text()).resolves.toBe('success');

    const unpaid = await prisma.order.findUnique({ where: { id: 'order-b' }, select: { status: true, paidAt: true } });
    expect(unpaid).toEqual({ status: 'unpaid', paidAt: null });
    expect(await prisma.paymentAttempt.findUnique({ where: { outTradeNo: 'LP-B' } })).toMatchObject({
      status: 'paid_stock_shortfall_reconciliation_required',
      tradeNo: 'trade-LP-B',
    });
    expect(await prisma.inventoryReservation.count()).toBe(1);
    expect(await prisma.inventoryAccount.findFirst()).toMatchObject({ reservedQuantity: 1, availableQuantity: 0 });
    expect(await prisma.auditLog.count({ where: { action: 'payment.alipay_stock_shortfall_reconciliation_required' } })).toBe(1);

    const duplicate = await POST(notify('LP-A'));
    expect(duplicate.status).toBe(200);
    await prisma.$transaction((tx) => reserveOrderInventory(tx, 'order-a', 'admin'));
    expect(await prisma.inventoryReservation.count()).toBe(1);
    expect(await prisma.inventoryAccount.findFirst()).toMatchObject({ reservedQuantity: 1, availableQuantity: 0 });
    expect(await prisma.inventoryTransaction.count({ where: { orderId: 'order-a', type: 'reserve' } })).toBe(1);
  });

  it('rolls back a short reservation and can settle the same payment after stock is replenished', async () => {
    seedOrder('order-short', 'LP-SHORT', 2, 1);

    const short = await POST(notify('LP-SHORT', '200.00'));
    expect(short.status).toBe(200);
    expect(await prisma.order.findUnique({ where: { id: 'order-short' }, select: { status: true, paidAt: true } })).toEqual({
      status: 'unpaid',
      paidAt: null,
    });
    expect(await prisma.inventoryReservation.count()).toBe(0);
    expect(await prisma.product.findUnique({ where: { id: 'p1' }, select: { stockQuantity: true } })).toEqual({ stockQuantity: 1 });

    const repeat = await POST(notify('LP-SHORT', '200.00'));
    expect(repeat.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'payment.alipay_stock_shortfall_reconciliation_required' } })).toBe(1);

    getTestDb().prepare('UPDATE Product SET stockQuantity = 5 WHERE id = ?').run('p1');
    const recovered = await POST(notify('LP-SHORT', '200.00'));
    expect(recovered.status).toBe(200);
    expect(await prisma.order.findUnique({ where: { id: 'order-short' }, select: { status: true, paidAt: true } })).toMatchObject({
      status: 'pending',
    });
    expect((await prisma.order.findUnique({ where: { id: 'order-short' }, select: { paidAt: true } }))?.paidAt).toBeTruthy();
    expect(await prisma.paymentAttempt.findUnique({ where: { outTradeNo: 'LP-SHORT' } })).toMatchObject({ status: 'paid' });
    expect(await prisma.inventoryAccount.findFirst()).toMatchObject({
      actualQuantity: 5,
      reservedQuantity: 2,
      availableQuantity: 3,
    });
  });

  it('still accepts payment for unknown stock without driving available quantity negative', async () => {
    seedOrder('order-open', 'LP-OPEN', 2, -1);
    const response = await POST(notify('LP-OPEN', '200.00'));
    expect(response.status).toBe(200);
    expect(await prisma.order.findUnique({ where: { id: 'order-open' }, select: { status: true } })).toEqual({ status: 'pending' });
    expect(await prisma.inventoryAccount.findFirst()).toMatchObject({
      actualQuantity: -1,
      availableQuantity: -1,
      reservedQuantity: 2,
    });
  });
});
