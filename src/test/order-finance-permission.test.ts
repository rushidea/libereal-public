import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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

import { PATCH as adminOrderPATCH } from '@/app/api/admin/orders/[id]/route';
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
  it('uses finance only for postpaid settlement and closing an order that still occupies credit', () => {
    expect(orderStatusRequiresFinanceWrite({
      currentStatus: 'confirmed', nextStatus: 'completed', paymentMethod: 'bank_transfer', hasOpenReceivable: true,
    })).toBe(true);
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

describe('finance permissions on payment, refund and settlement', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    clearAllTables(getTestDb());
    seedUser(getTestDb(), { id: 'user_1', email: 'buyer@test.com', tier: 'standard' });
    sessionMocks.requireAdmin.mockReset();
    sessionMocks.requireActiveSession.mockReset();
    allowExcept(null);
  });

  it('rejects postpaid completion without finance.write and settles when finance.write is present', async () => {
    seedOrder({ id: 'o_pay', status: 'confirmed', paymentMethod: 'bank_transfer' });
    await seedOpenReceivable('o_pay');
    allowExcept('finance.write');

    const denied = await adminOrderPATCH(patch('http://localhost/api/admin/orders/o_pay', { status: 'completed' }), {
      params: Promise.resolve({ id: 'o_pay' }),
    });
    expect(denied.status).toBe(403);
    expect(sessionMocks.requireAdmin).toHaveBeenCalledWith('finance.write');
    expect(sessionMocks.requireAdmin).not.toHaveBeenCalledWith('orders.write');
    expect(getTestDb().prepare('SELECT status FROM "Order" WHERE id = ?').get('o_pay')).toEqual({ status: 'confirmed' });

    allowExcept(null);
    const allowed = await adminOrderPATCH(patch('http://localhost/api/admin/orders/o_pay', { status: 'completed' }), {
      params: Promise.resolve({ id: 'o_pay' }),
    });
    expect(allowed.status).toBe(200);
    expect(await prisma.accountReceivable.findUnique({ where: { orderId: 'o_pay' } })).toMatchObject({ status: 'paid' });
    expect(await prisma.creditAccount.findUnique({ where: { userId: 'user_1' } })).toMatchObject({ usedAmount: 0, status: 'active' });
  });

  it('uses orders.write to confirm or ship, and finance.write to cancel an open receivable', async () => {
    await prisma.creditAccount.create({
      data: { userId: 'user_1', baseLimit: 5000, usedAmount: 0, status: 'active' },
    });
    seedOrder({ id: 'o_confirm', status: 'pending', paymentMethod: 'bank_transfer' });
    allowExcept('finance.write');
    const confirmed = await adminOrderPATCH(patch('http://localhost/api/admin/orders/o_confirm', { status: 'confirmed' }), {
      params: Promise.resolve({ id: 'o_confirm' }),
    });
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

  it('requires finance.write for the order page settlement path and for points refunds', async () => {
    seedOrder({ id: 'o_page', status: 'confirmed', paymentMethod: 'casmart' });
    await seedOpenReceivable('o_page');
    allowExcept('finance.write');

    const denied = await customerOrderPATCH(patch('http://localhost/api/orders/o_page', { status: 'completed' }), {
      params: Promise.resolve({ id: 'o_page' }),
    });
    expect(denied.status).toBe(403);
    expect(sessionMocks.requireAdmin).toHaveBeenCalledWith('finance.write');
    expect(getTestDb().prepare('SELECT status FROM "Order" WHERE id = ?').get('o_page')).toEqual({ status: 'confirmed' });

    allowExcept(null);
    const allowed = await customerOrderPATCH(patch('http://localhost/api/orders/o_page', { status: 'completed' }), {
      params: Promise.resolve({ id: 'o_page' }),
    });
    expect(allowed.status).toBe(200);
    expect(await prisma.accountReceivable.findUnique({ where: { orderId: 'o_page' } })).toMatchObject({ status: 'paid' });

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
