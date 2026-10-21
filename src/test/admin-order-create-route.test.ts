import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));
vi.mock('@/lib/security/security-session-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/security-session-service')>();
  return {
    ...actual,
    getSecuritySessionState: vi.fn().mockResolvedValue({ known: true, active: true }),
    touchSecuritySession: vi.fn().mockResolvedValue(true),
    hasRecentSecuritySessionMfa: vi.fn().mockResolvedValue(false),
  };
});

import { POST as ordersPOST } from '@/app/api/admin/orders/route';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

function makeReq(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function seedAntibody(price = 100) {
  getTestDb().prepare(`
    INSERT INTO Product (id, catalogNumber, name, brand, price, category, applications, reactivity, createdAt, updatedAt)
    VALUES ('prod_ab', 'AB-1', '抗体A', 'CST', ?, '一抗', '[]', '[]', datetime('now'), datetime('now'))
  `).run(price);
}

describe('POST /api/admin/orders fee and price validation', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
  });

  it('stores finite fees and the creating admin, and writes an audit log', async () => {
    const res = await ordersPOST(makeReq({
      customerEmail: 'cust@test.com',
      items: [{ name: '抗体A', price: 10.5, quantity: 2 }],
      platformFee: 1.25,
      transferFee: 0.5,
      paymentMethod: 'bank_transfer',
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.warnings).toEqual([]);
    expect(json.order.createdByAdminId).toBe('admin_test_id');
    expect(json.order.subtotal).toBe(21);
    expect(json.order.adjustmentTotal).toBe(1.75);
    expect(json.order.total).toBe(22.75);

    const db = getTestDb();
    expect(db.prepare('SELECT created_by_admin_id, subtotal, adjustmentTotal, total FROM "Order" WHERE id = ?').get(json.orderId)).toEqual({
      created_by_admin_id: 'admin_test_id',
      subtotal: 21,
      adjustmentTotal: 1.75,
      total: 22.75,
    });
    expect(db.prepare('SELECT actorId, actorEmail, reason FROM OrderStatusHistory WHERE orderId = ?').get(json.orderId)).toEqual({
      actorId: 'admin_test_id',
      actorEmail: 'admin@test.com',
      reason: 'admin_order_created',
    });
    expect(db.prepare('SELECT actorId, actorEmail, type FROM OrderEvent WHERE orderId = ?').get(json.orderId)).toEqual({
      actorId: 'admin_test_id',
      actorEmail: 'admin@test.com',
      type: 'order_created',
    });
    expect(db.prepare('SELECT type, amount, createdBy FROM OrderAdjustment WHERE orderId = ? ORDER BY type').all(json.orderId)).toEqual([
      { type: 'platform_fee', amount: 1.25, createdBy: 'admin_test_id' },
      { type: 'transfer_fee', amount: 0.5, createdBy: 'admin_test_id' },
    ]);
    const audit = db.prepare('SELECT action, resource, targetType, targetId, actorId, actorEmail FROM AuditLog WHERE action = ?').get('order.admin_created');
    expect(audit).toEqual({
      action: 'order.admin_created',
      resource: 'orders',
      targetType: 'Order',
      targetId: json.orderId,
      actorId: 'admin_test_id',
      actorEmail: 'admin@test.com',
    });
  });

  it('returns 400 in Chinese and does not create an order for illegal fees, prices, or quantities', async () => {
    const cases = [
      { platformFee: -1, transferFee: 0, items: [{ name: '抗体A', price: 10, quantity: 1 }], error: '平台服务费必须是有限、非负、最多两位小数的数字' },
      { platformFee: null, transferFee: 0, items: [{ name: '抗体A', price: 10, quantity: 1 }], error: '平台服务费必须是有限、非负、最多两位小数的数字' },
      { platformFee: 0, transferFee: 1.234, items: [{ name: '抗体A', price: 10, quantity: 1 }], error: '转账手续费必须是有限、非负、最多两位小数的数字' },
      { platformFee: 0, transferFee: 0, items: [{ name: '抗体A', price: -5, quantity: 1 }], error: '第 1 行「抗体A」单价必须是有限、非负、最多两位小数的数字' },
      { platformFee: 0, transferFee: 0, items: [{ name: '抗体A', price: 10.555, quantity: 1 }], error: '第 1 行「抗体A」单价必须是有限、非负、最多两位小数的数字' },
      { platformFee: 0, transferFee: 0, items: [{ name: '抗体A', price: 10, quantity: 1.5 }], error: '第 1 行「抗体A」数量必须为正整数' },
      { platformFee: 0, transferFee: 0, items: [{ name: '抗体A', price: 10, quantity: 0 }], error: '第 1 行「抗体A」数量必须为正整数' },
      { platformFee: 0, transferFee: 0, items: [{ name: '抗体A', price: 10 }], error: '第 1 行「抗体A」数量必须为正整数' },
    ];

    for (const input of cases) {
      const db = getTestDb();
      clearAllTables(db);
      seedAdmin(db);
      const res = await ordersPOST(makeReq({
        customerEmail: 'cust@test.com',
        paymentMethod: 'bank_transfer',
        confirmWarnings: true,
        ...input,
      }));
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error).toBe(input.error);
      expect(db.prepare('SELECT COUNT(*) AS count FROM "Order"').get()).toEqual({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM AuditLog').get()).toEqual({ count: 0 });
    }
  });

  it('allows a zero unit price and does not turn sanity warnings into a block', async () => {
    const zero = await ordersPOST(makeReq({
      customerEmail: 'cust@test.com',
      items: [{ name: '未建档', price: 0, quantity: 1 }],
      paymentMethod: 'alipay',
    }));
    expect(zero.status).toBe(200);
    const zeroJson = await zero.json();
    expect(zeroJson.order.subtotal).toBe(0);
    expect(zeroJson.warnings).toEqual([]);

    seedAntibody(100);
    const hinted = await ordersPOST(makeReq({
      customerEmail: 'cust@test.com',
      items: [{ productId: 'prod_ab', catalogNumber: 'AB-1', name: '抗体A', price: 20, quantity: 11 }],
      paymentMethod: 'bank_transfer',
    }));
    const json = await hinted.json();
    expect(hinted.status).toBe(200);
    expect(json.orderId).toMatch(/^ORD-/);
    expect(json.order.createdByAdminId).toBe('admin_test_id');
    expect(json.warnings.map((warning: { code: string }) => warning.code).sort()).toEqual([
      'quantity_abnormally_large',
      'unit_price_below_catalog',
    ]);
    expect(json.warnings.some((warning: { message: string }) => warning.message.includes('请确认是否输入错误'))).toBe(true);
    const db = getTestDb();
    expect(db.prepare('SELECT COUNT(*) AS count FROM "Order"').get()).toEqual({ count: 2 });
    const metadata = db.prepare('SELECT metadata FROM AuditLog WHERE targetId = ?').get(json.orderId) as { metadata: string };
    expect(JSON.parse(metadata.metadata).warnings.map((warning: { code: string }) => warning.code).sort()).toEqual([
      'quantity_abnormally_large',
      'unit_price_below_catalog',
    ]);
  });

  it('still ignores points fields and does not deduct the customer balance', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'cust_points', email: 'cust@test.com', name: '客户', points: 80 });
    const res = await ordersPOST(makeReq({
      customerEmail: 'cust@test.com',
      items: [{ name: '抗体A', price: 100, quantity: 1 }],
      paymentMethod: 'alipay',
      personalPoints: 20,
      groupPoints: 5,
      groupId: 'group-1',
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(db.prepare('SELECT pointsPersonal, pointsGroup, pointsDiscount, pointsApplied, created_by_admin_id FROM "Order" WHERE id = ?').get(json.orderId)).toEqual({
      pointsPersonal: 0,
      pointsGroup: 0,
      pointsDiscount: 0,
      pointsApplied: 0,
      created_by_admin_id: 'admin_test_id',
    });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('cust_points')).toEqual({ points: 80 });
  });
});
