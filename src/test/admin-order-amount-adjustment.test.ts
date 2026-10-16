import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ADMIN_ROLE_DEFINITIONS, type AdminRoleKey } from '@/lib/admin-permissions';
import { prisma } from '@/lib/prisma';
import { applyOrderAmountAdjustment } from '@/lib/order-amount-adjustment';
import { settleOrderReceivable } from '@/lib/customer-credit';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));

import { auth } from '@/lib/auth';
import { DELETE as adjustmentDELETE, POST as adjustmentPOST } from '@/app/api/admin/orders/[id]/adjustments/route';

function signInAs(id: string, email: string) {
  vi.mocked(auth).mockResolvedValue({
    user: { id, email, name: email, role: 'admin', sessionId: 'session-1' },
  } as never);
}

function assignRole(userId: string, email: string, roleKey: AdminRoleKey) {
  const db = getTestDb();
  seedUser(db, { id: userId, email, name: roleKey, role: 'admin' });
  const role = ADMIN_ROLE_DEFINITIONS[roleKey];
  const roleId = `role_${roleKey}`;
  db.prepare(`
    INSERT OR IGNORE INTO AdminRole (id, key, name, description, updatedAt)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(roleId, roleKey, role.name, role.description);
  const link = db.prepare('INSERT OR IGNORE INTO AdminRolePermission (roleId, permissionId) VALUES (?, ?)');
  for (const key of role.permissions) {
    link.run(roleId, `perm_${key.replace('.', '_')}`);
  }
  db.prepare('INSERT OR IGNORE INTO AdminUserRole (userId, roleId) VALUES (?, ?)').run(userId, roleId);
}

function seedCreditOrder(options: {
  id?: string;
  status?: string;
  total?: number;
  paymentMethod?: string | null;
  receivableStatus?: string | null;
  usedAmount?: number;
  baseLimit?: number;
  accountStatus?: string;
}) {
  const db = getTestDb();
  const id = options.id ?? 'o1';
  const total = options.total ?? 4000;
  db.prepare(`
    INSERT INTO "Order" (
      id, email, customerId, subtotal, adjustmentTotal, total, status, paymentMethod, shippingMethod, operationLogs, createdAt, updatedAt
    ) VALUES (?, 'buyer@test.com', 'user_1', ?, 0, ?, ?, ?, 'logistics', '[]', datetime('now'), datetime('now'))
  `).run(id, total, total, options.status ?? 'confirmed', options.paymentMethod === undefined ? 'bank_transfer' : options.paymentMethod);
  db.prepare(`
    INSERT INTO OrderItem (id, orderId, position, productId, name, unitPrice, quantity, shippedQty, status, createdAt, updatedAt)
    VALUES (?, ?, 0, 'p1', '产品A', ?, 1, 0, 'pending', datetime('now'), datetime('now'))
  `).run(`${id}_item`, id, total);
  if (options.receivableStatus === null) return;
  db.prepare(`
    INSERT INTO CreditAccount (
      id, userId, baseLimit, usedAmount, status, paymentTermDays, createdAt, updatedAt
    ) VALUES ('ca_user_1', 'user_1', ?, ?, ?, 30, datetime('now'), datetime('now'))
    ON CONFLICT(userId) DO UPDATE SET usedAmount = excluded.usedAmount, baseLimit = excluded.baseLimit, status = excluded.status
  `).run(options.baseLimit ?? 5000, options.usedAmount ?? total, options.accountStatus ?? 'active');
  db.prepare(`
    INSERT INTO AccountReceivable (
      id, orderId, userId, amount, status, confirmedAt, paymentTermDaysSnapshot, createdAt, updatedAt
    ) VALUES (?, ?, 'user_1', ?, ?, datetime('now'), 30, datetime('now'), datetime('now'))
  `).run(`ar_${id}`, id, total, options.receivableStatus ?? 'open');
}

function postAdjustment(id: string, body: object) {
  return adjustmentPOST(new NextRequest(`http://localhost:3000/api/admin/orders/${id}/adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

describe('admin order amount adjustments', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'user_1', email: 'buyer@test.com', tier: '璞玉' });
    signInAs('admin_test_id', 'admin@test.com');
  });

  it('updates the open receivable and occupied credit inside the same transaction, then settles on the new amount', async () => {
    seedCreditOrder({ usedAmount: 4500 });
    const res = await postAdjustment('o1', { type: 'discount', label: '议价', amount: -1000, reason: '客户议价' });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ total: 3000 });

    const db = getTestDb();
    expect(db.prepare('SELECT total, adjustmentTotal FROM "Order" WHERE id = ?').get('o1')).toEqual({
      total: 3000,
      adjustmentTotal: -1000,
    });
    expect(db.prepare('SELECT amount, status FROM AccountReceivable WHERE orderId = ?').get('o1')).toEqual({
      amount: 3000,
      status: 'open',
    });
    expect(db.prepare('SELECT usedAmount FROM CreditAccount WHERE userId = ?').get('user_1')).toEqual({ usedAmount: 3500 });
    expect(db.prepare(`SELECT type, amount, balanceAfter, reason FROM CreditTransaction WHERE orderId = ? AND type = 'amount_adjust'`).get('o1')).toEqual({
      type: 'amount_adjust',
      amount: -1000,
      balanceAfter: 3500,
      reason: '订单改价同步应收',
    });
    const audit = db.prepare('SELECT action, resource, targetId, reason, beforeData, afterData FROM AuditLog WHERE targetId = ?').get('o1') as {
      action: string;
      resource: string;
      targetId: string;
      reason: string;
      beforeData: string;
      afterData: string;
    };
    expect(audit).toMatchObject({
      action: 'order.amount_adjusted',
      resource: 'orders',
      targetId: 'o1',
      reason: '客户议价',
    });
    expect(JSON.parse(audit.beforeData)).toMatchObject({ total: 4000, receivableAmount: 4000, usedAmount: 4500 });
    expect(JSON.parse(audit.afterData)).toMatchObject({ total: 3000, receivableAmount: 3000, usedAmount: 3500 });

    await prisma.$transaction((tx) => settleOrderReceivable(tx, 'o1', 'admin_test_id'));
    expect(db.prepare('SELECT usedAmount FROM CreditAccount WHERE userId = ?').get('user_1')).toEqual({ usedAmount: 500 });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('user_1')).toEqual({ points: 3 });
    expect(db.prepare(`SELECT amount FROM CreditTransaction WHERE orderId = ? AND type = 'release'`).get('o1')).toEqual({ amount: -3000 });
  });

  it('applies a second adjustment to rows written earlier in the same transaction', async () => {
    seedCreditOrder({});
    await prisma.$transaction(async (tx) => {
      await applyOrderAmountAdjustment(tx, {
        orderId: 'o1',
        actor: { id: 'admin_test_id', email: 'admin@test.com' },
        change: { op: 'create', type: 'discount', label: '第一次', amount: -100, reason: null },
      });
      await applyOrderAmountAdjustment(tx, {
        orderId: 'o1',
        actor: { id: 'admin_test_id', email: 'admin@test.com' },
        change: { op: 'create', type: 'discount', label: '第二次', amount: -50, reason: null },
      });
    });

    const db = getTestDb();
    expect(db.prepare('SELECT COUNT(*) AS count FROM OrderAdjustment WHERE orderId = ?').get('o1')).toEqual({ count: 2 });
    expect(db.prepare('SELECT total, adjustmentTotal FROM "Order" WHERE id = ?').get('o1')).toEqual({
      total: 3850,
      adjustmentTotal: -150,
    });
    expect(db.prepare('SELECT amount FROM AccountReceivable WHERE orderId = ?').get('o1')).toEqual({ amount: 3850 });
    expect(db.prepare('SELECT usedAmount FROM CreditAccount WHERE userId = ?').get('user_1')).toEqual({ usedAmount: 3850 });
  });

  it('restores receivable and credit when an adjustment is removed', async () => {
    seedCreditOrder({});
    const created = await postAdjustment('o1', { type: 'shipping', label: '运费', amount: 200 });
    expect(created.status).toBe(201);
    const { adjustment } = await created.json() as { adjustment: { id: string } };

    const removed = await adjustmentDELETE(new NextRequest('http://localhost:3000/api/admin/orders/o1/adjustments', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adjustmentId: adjustment.id }),
    }), { params: Promise.resolve({ id: 'o1' }) });
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toMatchObject({ success: true, total: 4000 });

    const db = getTestDb();
    expect(db.prepare('SELECT COUNT(*) AS count FROM OrderAdjustment').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT amount FROM AccountReceivable WHERE orderId = ?').get('o1')).toEqual({ amount: 4000 });
    expect(db.prepare('SELECT usedAmount FROM CreditAccount WHERE userId = ?').get('user_1')).toEqual({ usedAmount: 4000 });
  });

  it('rejects increases above the credit limit without saving the adjustment', async () => {
    seedCreditOrder({});
    const res = await postAdjustment('o1', { type: 'platform_fee', label: '加价', amount: 1500 });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'CREDIT_LIMIT_EXCEEDED' });
    const db = getTestDb();
    expect(db.prepare('SELECT COUNT(*) AS count FROM OrderAdjustment').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT total FROM "Order" WHERE id = ?').get('o1')).toEqual({ total: 4000 });
    expect(db.prepare('SELECT amount FROM AccountReceivable WHERE orderId = ?').get('o1')).toEqual({ amount: 4000 });
    expect(db.prepare('SELECT usedAmount FROM CreditAccount WHERE userId = ?').get('user_1')).toEqual({ usedAmount: 4000 });
  });

  it('locks shipped, partially shipped, closed, completed and cancelled orders', async () => {
    for (const status of ['shipped', 'partially_shipped', 'closed', 'completed', 'cancelled']) {
      clearAllTables(getTestDb());
      seedAdmin(getTestDb());
      seedUser(getTestDb(), { id: 'user_1', email: 'buyer@test.com', tier: '璞玉' });
      seedCreditOrder({ status, receivableStatus: status === 'completed' ? 'paid' : status === 'cancelled' ? 'cancelled' : 'open' });
      const res = await postAdjustment('o1', { type: 'discount', label: '议价', amount: -100 });
      expect(res.status, status).toBe(409);
      await expect(res.json()).resolves.toEqual({ error: 'ORDER_AMOUNT_LOCKED' });
      expect(getTestDb().prepare('SELECT total FROM "Order" WHERE id = ?').get('o1')).toEqual({ total: 4000 });
      expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM OrderAdjustment').get()).toEqual({ count: 0 });
    }
  });

  it('still adjusts a pending order that has not reserved credit, and records an audit entry', async () => {
    seedCreditOrder({ status: 'pending', paymentMethod: null, receivableStatus: null, total: 4000 });
    const res = await postAdjustment('o1', { type: 'discount', label: '下单前折扣', amount: -100 });
    expect(res.status).toBe(201);
    const db = getTestDb();
    expect(db.prepare('SELECT total FROM "Order" WHERE id = ?').get('o1')).toEqual({ total: 3900 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM AccountReceivable').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM CreditTransaction').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT action FROM AuditLog').get()).toEqual({ action: 'order.amount_adjusted' });
  });

  it('adjusts a confirmed prepaid order that has no receivable', async () => {
    seedCreditOrder({ paymentMethod: 'alipay', receivableStatus: null });
    const res = await postAdjustment('o1', { type: 'discount', label: '预付改价', amount: -100 });
    expect(res.status).toBe(201);
    const db = getTestDb();
    expect(db.prepare('SELECT total FROM "Order" WHERE id = ?').get('o1')).toEqual({ total: 3900 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM AccountReceivable').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM CreditTransaction').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT action FROM AuditLog').get()).toEqual({ action: 'order.amount_adjusted' });
  });

  it('rejects a confirmed post-delivery order that has no receivable', async () => {
    seedCreditOrder({ receivableStatus: null });
    const res = await postAdjustment('o1', { type: 'discount', label: '议价', amount: -100 });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'RECEIVABLE_NOT_FOUND' });
    expect(getTestDb().prepare('SELECT total FROM "Order" WHERE id = ?').get('o1')).toEqual({ total: 4000 });
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM OrderAdjustment').get()).toEqual({ count: 0 });
  });

  it('rejects pricing.write alone and allows orders.write or finance.write', async () => {
    assignRole('product_admin_id', 'product-admin@test.com', 'product_admin');
    assignRole('order_admin_id', 'order-admin@test.com', 'order_admin');
    assignRole('finance_staff_id', 'finance-staff@test.com', 'finance_staff');
    seedCreditOrder({});

    signInAs('product_admin_id', 'product-admin@test.com');
    const denied = await postAdjustment('o1', { type: 'discount', label: '议价', amount: -100 });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toEqual({ error: 'Forbidden', requiredPermission: 'orders.write' });
    expect(getTestDb().prepare('SELECT total FROM "Order" WHERE id = ?').get('o1')).toEqual({ total: 4000 });
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM OrderAdjustment').get()).toEqual({ count: 0 });

    signInAs('order_admin_id', 'order-admin@test.com');
    const byOrderAdmin = await postAdjustment('o1', { type: 'discount', label: '订单改价', amount: -100 });
    expect(byOrderAdmin.status).toBe(201);
    expect(getTestDb().prepare('SELECT amount FROM AccountReceivable WHERE orderId = ?').get('o1')).toEqual({ amount: 3900 });

    signInAs('finance_staff_id', 'finance-staff@test.com');
    const byFinance = await postAdjustment('o1', { type: 'manual', label: '财务改价', amount: -50 });
    expect(byFinance.status).toBe(201);
    expect(getTestDb().prepare('SELECT total FROM "Order" WHERE id = ?').get('o1')).toEqual({ total: 3850 });
    expect(getTestDb().prepare('SELECT amount FROM AccountReceivable WHERE orderId = ?').get('o1')).toEqual({ amount: 3850 });
    expect(getTestDb().prepare('SELECT usedAmount FROM CreditAccount WHERE userId = ?').get('user_1')).toEqual({ usedAmount: 3850 });
  });
});
