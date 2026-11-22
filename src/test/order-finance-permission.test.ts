import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { reserveOrderCredit } from '@/lib/customer-credit';
import { orderStatusRequiresFinanceWrite } from '@/lib/order-finance-access';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

const sessionMocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireActiveSession: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  requireAdmin: sessionMocks.requireAdmin,
  requireActiveSession: sessionMocks.requireActiveSession,
}));

import { GET as adminOrderGET, PATCH as adminOrderPATCH } from '@/app/api/admin/orders/[id]/route';
import { POST as pointsRefundPOST } from '@/app/api/admin/orders/[id]/points-refund/route';
import { PATCH as customerOrderPATCH } from '@/app/api/orders/[id]/route';

const finance = { id: 'finance_id', email: 'finance@test.com', role: 'admin' as const };

function forbidden(permission: string) {
  return NextResponse.json({ error: 'Forbidden', requiredPermission: permission }, { status: 403 });
}

function allowExcept(denied: string | null) {
  sessionMocks.requireAdmin.mockImplementation(async (permission?: string) => {
    if (denied && permission === denied) return forbidden(denied);
    return finance;
  });
  sessionMocks.requireActiveSession.mockResolvedValue(finance);
}

function seedOrder(input: { id: string; status: string; paymentMethod: string; total?: number }) {
  const total = input.total ?? 1000;
  const db = getTestDb();
  db.prepare(`INSERT OR IGNORE INTO Product (id, catalogNumber, name, brand, price, stockQuantity, applications, reactivity, createdAt, updatedAt) VALUES ('p1', 'p1', '产品A', '测试品牌', 100, -1, '[]', '[]', datetime('now'), datetime('now'))`).run();
  db.prepare(`
    INSERT INTO "Order" (id, email, customerId, subtotal, total, status, paymentMethod, shippingMethod, operationLogs, createdAt, updatedAt)
    VALUES (?, 'buyer@test.com', 'user_1', ?, ?, ?, ?, 'logistics', '[]', datetime('now'), datetime('now'))
  `).run(input.id, total, total, input.status, input.paymentMethod);
  db.prepare(`
    INSERT INTO OrderItem (id, orderId, position, productId, name, unitPrice, quantity, shippedQty, status, createdAt, updatedAt)
    VALUES (?, ?, 0, 'p1', '产品A', ?, 1, 0, 'pending', datetime('now'), datetime('now'))
  `).run(`${input.id}_item`, input.id, total);
}

async function seedOpenReceivable(orderId: string, amount = 1000) {
  await prisma.creditAccount.upsert({
    where: { userId: 'user_1' },
    update: { usedAmount: amount, status: 'active', statusSource: 'system' },
    create: { userId: 'user_1', baseLimit: 5000, usedAmount: amount, status: 'active', statusSource: 'system' },
  });
  await prisma.accountReceivable.create({
    data: {
      orderId,
      userId: 'user_1',
      amount,
      status: 'open',
      confirmedAt: new Date(),
      paymentTermDaysSnapshot: 30,
    },
  });
}

function patch(url: string, body: object) {
  return new NextRequest(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('orderStatusRequiresFinanceWrite', () => {
  it('requires finance to cancel an order that still occupies credit', () => {
    expect(orderStatusRequiresFinanceWrite({
      currentStatus: 'confirmed', nextStatus: 'completed', paymentMethod: 'bank_transfer', hasOpenReceivable: true,
    })).toBe(false);
    expect(orderStatusRequiresFinanceWrite({
      currentStatus: 'shipped', nextStatus: 'completed', paymentMethod: 'alipay', hasOpenReceivable: false,
    })).toBe(false);
    expect(orderStatusRequiresFinanceWrite({
      currentStatus: 'confirmed', nextStatus: 'cancelled', paymentMethod: 'rjmart', hasOpenReceivable: true,
    })).toBe(true);
    expect(orderStatusRequiresFinanceWrite({
      currentStatus: 'pending', nextStatus: 'cancelled', paymentMethod: 'bank_transfer', hasOpenReceivable: false,
    })).toBe(false);
    expect(orderStatusRequiresFinanceWrite({
      currentStatus: 'confirmed', nextStatus: 'shipped', paymentMethod: 'casmart', hasOpenReceivable: true,
    })).toBe(false);
    expect(orderStatusRequiresFinanceWrite({
      currentStatus: 'cancelled', nextStatus: 'closed', paymentMethod: 'bank_transfer', hasOpenReceivable: true,
    })).toBe(false);
  });
});

describe('order completion and financial permissions', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    clearAllTables(getTestDb());
    seedUser(getTestDb(), { id: 'user_1', email: 'buyer@test.com', tier: 'standard' });
    sessionMocks.requireAdmin.mockReset();
    sessionMocks.requireActiveSession.mockReset();
    allowExcept(null);
  });

  it.each([
    { path: '/api/admin/orders', handler: adminOrderPATCH },
    { path: '/api/orders', handler: customerOrderPATCH },
  ])('requires actual delivery and preserves bank receivables on $path', async ({ path, handler }) => {
    const orderId = 'o_delivery';
    const orderItemId = 'o_delivery_item';
    const userId = 'user_1';
    const url = `http://localhost${path}/${orderId}`;
    const complete = () => handler(patch(url, { status: 'completed' }), { params: Promise.resolve({ id: orderId }) });
    seedOrder({ id: orderId, status: 'shipped', paymentMethod: 'bank_transfer' });
    await prisma.orderItem.update({ where: { id: orderItemId }, data: { quantity: 2, unitPrice: 500, shippedQty: 2 } });
    await prisma.creditAccount.create({ data: { userId, baseLimit: 5000, paymentTermDays: 30 } });
    const receivable = await prisma.$transaction(tx => reserveOrderCredit(tx, orderId, finance.id));
    await prisma.user.update({ where: { id: userId }, data: { points: 17 } });

    allowExcept('orders.write');
    expect((await complete()).status).toBe(403);
    expect(sessionMocks.requireAdmin).toHaveBeenCalledWith('orders.write');

    allowExcept(null);
    expect((await complete()).status).toBe(409);

    const shippedAt = new Date('2026-11-20T01:00:00Z');
    const deliveredAt = new Date('2026-11-21T01:00:00Z');
    await prisma.shipment.create({ data: {
      id: 'shipment-first', orderId, status: 'delivered', shippedAt, deliveredAt,
      items: { create: { orderItemId, quantity: 1 } },
    } });
    await prisma.shipment.create({ data: {
      id: 'shipment-second', orderId, status: 'delivered', deliveredAt,
      items: { create: { orderItemId, quantity: 1 } },
    } });
    expect((await complete()).status).toBe(409);

    await prisma.shipment.update({ where: { id: 'shipment-second' }, data: { shippedAt, status: 'shipped' } });
    expect((await complete()).status).toBe(409);

    await prisma.shipment.create({ data: {
      id: 'historical-delivery-without-dispatch', orderId, status: 'delivered', deliveredAt,
      items: { create: { orderItemId, quantity: 1 } },
    } });
    expect((await complete()).status).toBe(409);
    await prisma.shipment.delete({ where: { id: 'historical-delivery-without-dispatch' } });

    await prisma.shipment.update({ where: { id: 'shipment-second' }, data: {
      status: 'delivered', deliveredAt: new Date('2026-11-19T01:00:00Z'),
    } });
    expect((await complete()).status).toBe(409);

    await prisma.shipment.update({ where: { id: 'shipment-second' }, data: { deliveredAt: null } });
    expect((await complete()).status).toBe(409);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: 'shipped', paidAt: null });

    await prisma.shipment.update({ where: { id: 'shipment-second' }, data: { deliveredAt } });
    sessionMocks.requireAdmin.mockClear();
    allowExcept('finance.write');
    const completed = await complete();
    expect(completed.status, await completed.text()).toBe(200);
    expect(sessionMocks.requireAdmin).toHaveBeenCalledWith('orders.write');
    expect(sessionMocks.requireAdmin).not.toHaveBeenCalledWith('finance.write');
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: 'completed', paidAt: null });
    expect(await prisma.accountReceivable.findUniqueOrThrow({ where: { orderId } })).toEqual(receivable);
    expect(receivable).toMatchObject({ status: 'open', paidAt: null, amount: 1000 });
    expect(await prisma.creditAccount.findUniqueOrThrow({ where: { userId } })).toMatchObject({ usedAmount: 1000, status: 'active' });
    expect(await prisma.creditTransaction.findMany({ where: { orderId } })).toMatchObject([
      { type: 'reserve', amount: 1000, balanceAfter: 1000 },
    ]);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ points: 17 });
    expect(await prisma.pointsLog.count({ where: { userId } })).toBe(0);
  });

  it('uses orders.write to confirm or ship, and finance.write to cancel an open receivable', async () => {
    await prisma.creditAccount.create({
      data: { userId: 'user_1', baseLimit: 5000, usedAmount: 0, status: 'active' },
    });
    seedOrder({ id: 'o_confirm', status: 'pending', paymentMethod: 'bank_transfer' });
    allowExcept('finance.write');
    const params = { params: Promise.resolve({ id: 'o_confirm' }) };
    const url = 'http://localhost/api/admin/orders/o_confirm';
    const detail = await adminOrderGET(new NextRequest(url), params);
    const approval = (await detail.json()).order.approvalPreview;
    const confirmed = await adminOrderPATCH(patch(url, { status: 'confirmed', approvalVersion: approval.version }), params);
    expect(confirmed.status).toBe(200);
    expect(sessionMocks.requireAdmin).toHaveBeenCalledWith('orders.write');
    expect(sessionMocks.requireAdmin).not.toHaveBeenCalledWith('finance.write');

    seedOrder({ id: 'o_ship', status: 'confirmed', paymentMethod: 'bank_transfer' });
    sessionMocks.requireAdmin.mockClear();
    allowExcept('orders.write');
    const shipped = await adminOrderPATCH(patch('http://localhost/api/admin/orders/o_ship', { status: 'shipped' }), {
      params: Promise.resolve({ id: 'o_ship' }),
    });
    expect(shipped.status).toBe(403);
    expect(sessionMocks.requireAdmin).toHaveBeenCalledWith('orders.write');
    expect(getTestDb().prepare('SELECT status FROM "Order" WHERE id = ?').get('o_ship')).toEqual({ status: 'confirmed' });

    seedOrder({ id: 'o_plain', status: 'pending', paymentMethod: 'bank_transfer' });
    sessionMocks.requireAdmin.mockClear();
    allowExcept('finance.write');
    const plainCancel = await adminOrderPATCH(patch('http://localhost/api/admin/orders/o_plain', { status: 'cancelled' }), {
      params: Promise.resolve({ id: 'o_plain' }),
    });
    expect(plainCancel.status).toBe(200);
    expect(sessionMocks.requireAdmin).toHaveBeenCalledWith('orders.write');

    seedOrder({ id: 'o_credit', status: 'confirmed', paymentMethod: 'bank_transfer' });
    await seedOpenReceivable('o_credit', 800);
    sessionMocks.requireAdmin.mockClear();
    allowExcept('finance.write');
    const deniedCancel = await adminOrderPATCH(patch('http://localhost/api/admin/orders/o_credit', { status: 'cancelled' }), {
      params: Promise.resolve({ id: 'o_credit' }),
    });
    expect(deniedCancel.status).toBe(403);
    expect(sessionMocks.requireAdmin).toHaveBeenCalledWith('finance.write');
    expect(await prisma.accountReceivable.findUnique({ where: { orderId: 'o_credit' } })).toMatchObject({ status: 'open' });

    allowExcept(null);
    const allowedCancel = await adminOrderPATCH(patch('http://localhost/api/admin/orders/o_credit', { status: 'cancelled' }), {
      params: Promise.resolve({ id: 'o_credit' }),
    });
    expect(allowedCancel.status).toBe(200);
    expect(await prisma.accountReceivable.findUnique({ where: { orderId: 'o_credit' } })).toMatchObject({ status: 'cancelled' });
  });

  it('requires finance.write for points refunds', async () => {
    seedOrder({ id: 'o_points', status: 'completed', paymentMethod: 'alipay' });
    sessionMocks.requireAdmin.mockClear();
    allowExcept('finance.write');
    const refund = await pointsRefundPOST(new NextRequest('http://localhost/api/admin/orders/o_points/points-refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refundYuan: 100 }),
    }), { params: Promise.resolve({ id: 'o_points' }) });
    expect(refund.status).toBe(403);
    expect(sessionMocks.requireAdmin).toHaveBeenCalledWith('finance.write');
    expect(sessionMocks.requireAdmin).not.toHaveBeenCalledWith('orders.write');
  });
});
