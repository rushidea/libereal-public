import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));

import { POST as quotePOST } from '@/app/api/inquiries/[id]/quote/route';
import { PATCH as orderPATCH } from '@/app/api/orders/[id]/route';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

function seedInquiry(price = 100, quantity = 1) {
  const db = getTestDb();
  db.prepare(`
    INSERT INTO Inquiry (id, name, email, phone, institution, status, createdAt, operationLogs)
    VALUES ('i1', '询价人', 'q@test.com', '13800000000', '清华大学', 'pending_quote', datetime('now'), '[]')
  `).run();
  db.prepare(`
    INSERT INTO InquiryItem (id, inquiryId, position, productId, name, unitPrice, quantity, lineTotal, createdAt, updatedAt)
    VALUES ('i1_item_0', 'i1', 0, 'prod_ab', '抗体A', ?, ?, ?, datetime('now'), datetime('now'))
  `).run(price, quantity, price * quantity);
}

function seedProduct(category = '一抗', price = 100) {
  getTestDb().prepare(`
    INSERT INTO Product (id, catalogNumber, name, brand, price, category, applications, reactivity, createdAt, updatedAt)
    VALUES ('prod_ab', 'AB-1', '抗体A', 'CST', ?, ?, '[]', '[]', datetime('now'), datetime('now'))
  `).run(price, category);
}

function seedOrder(price = 100, quantity = 1) {
  const db = getTestDb();
  db.prepare(`
    INSERT INTO "Order" (id, email, subtotal, total, status, shippingMethod, operationLogs, createdAt, updatedAt)
    VALUES ('o1', 'q@test.com', ?, ?, 'pending', 'logistics', '[]', datetime('now'), datetime('now'))
  `).run(price * quantity, price * quantity);
  db.prepare(`
    INSERT INTO OrderItem (id, orderId, position, productId, catalogNumber, name, unitPrice, quantity, shippedQty, status, createdAt, updatedAt)
    VALUES ('o1_item_0', 'o1', 0, 'prod_ab', 'AB-1', '抗体A', ?, ?, 0, 'pending', datetime('now'), datetime('now'))
  `).run(price, quantity);
}

function quoteRequest(body: object) {
  return new NextRequest('http://localhost/api/inquiries/i1/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function orderRequest(body: object) {
  return new NextRequest('http://localhost/api/orders/o1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('quote and order line review API', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedProduct();
    seedInquiry();
    seedOrder();
  });

  it('rejects a non-positive quote price and does not publish', async () => {
    const response = await quotePOST(quoteRequest({
      items: [{ productId: 'prod_ab', name: '抗体A', price: 0, quantity: 1 }],
    }), { params: Promise.resolve({ id: 'i1' }) });
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.code).toBe('COMMERCE_LINE_INVALID');
    expect(body.findings[0].code).toBe('unit_price_invalid');
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM Quote').get()).toEqual({ count: 0 });
  });

  it('rejects a non-integer quote quantity', async () => {
    const response = await quotePOST(quoteRequest({
      items: [{ productId: 'prod_ab', name: '抗体A', price: 100, quantity: 1.5 }],
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(response.status).toBe(400);
    expect((await response.json()).findings[0].code).toBe('quantity_invalid');
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM Quote').get()).toEqual({ count: 0 });
  });

  it('blocks a decimal-shift quote until warnings are confirmed, without pricing.write', async () => {
    getTestDb().prepare(`DELETE FROM AdminRolePermission WHERE permissionId = 'perm_pricing_write'`).run();
    const items = [{ productId: 'prod_ab', name: '抗体A', price: 10, quantity: 1 }];
    const blocked = await quotePOST(quoteRequest({ items }), { params: Promise.resolve({ id: 'i1' }) });
    const blockedBody = await blocked.json();
    expect(blocked.status).toBe(409);
    expect(blockedBody.code).toBe('COMMERCE_LINE_WARNINGS');
    expect(blockedBody.warnings.map((warning: { code: string }) => warning.code)).toEqual([
      'unit_price_below_catalog',
      'unit_price_decimal_shift',
    ]);
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM Quote').get()).toEqual({ count: 0 });

    const confirmed = await quotePOST(quoteRequest({ items, confirmWarnings: true }), { params: Promise.resolve({ id: 'i1' }) });
    expect(confirmed.status).toBe(200);
    const audit = getTestDb().prepare(`SELECT action, metadata FROM AuditLog WHERE action = 'quote.warnings_confirmed'`).get() as { action: string; metadata: string };
    expect(audit.action).toBe('quote.warnings_confirmed');
    expect(JSON.parse(audit.metadata).warnings.map((warning: { code: string }) => warning.code)).toEqual([
      'unit_price_below_catalog',
      'unit_price_decimal_shift',
    ]);
    expect(getTestDb().prepare('SELECT unitPrice FROM QuoteItem').get()).toEqual({ unitPrice: 10 });
  });

  it('publishes a reagent quote at the quantity limit without an audit row', async () => {
    const response = await quotePOST(quoteRequest({
      items: [{ productId: 'prod_ab', name: '抗体A', price: 100, quantity: 10 }],
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(response.status).toBe(200);
    expect(getTestDb().prepare(`SELECT COUNT(*) AS count FROM AuditLog WHERE action = 'quote.warnings_confirmed'`).get()).toEqual({ count: 0 });
  });

  it('warns when a reagent quote quantity exceeds 10', async () => {
    const response = await quotePOST(quoteRequest({
      items: [{ productId: 'prod_ab', name: '抗体A', price: 100, quantity: 11 }],
    }), { params: Promise.resolve({ id: 'i1' }) });
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.warnings.map((warning: { code: string }) => warning.code)).toEqual(['quantity_abnormally_large']);
    expect(body.warnings[0].message).toContain('试剂');
  });

  it('classifies lines from product taxonomy, not from the submitted name', async () => {
    const db = getTestDb();
    db.prepare(`UPDATE Product SET category = '分子生物学', subcategory = '分子生物学耗材', type = 'PCR 耗材' WHERE id = 'prod_ab'`).run();
    const withinConsumableLimit = await quotePOST(quoteRequest({
      items: [{ productId: 'prod_ab', name: '普通试剂', price: 100, quantity: 11 }],
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(withinConsumableLimit.status).toBe(200);

    const consumable = await quotePOST(quoteRequest({
      items: [{ productId: 'prod_ab', name: '普通试剂', price: 100, quantity: 51 }],
    }), { params: Promise.resolve({ id: 'i1' }) });
    const consumableBody = await consumable.json();
    expect(consumable.status).toBe(409);
    expect(consumableBody.warnings[0].message).toContain('耗材');

    db.prepare(`UPDATE Product SET category = '仪器设备', subcategory = '实验室常规仪器', type = '离心机', name = '离心机耗材' WHERE id = 'prod_ab'`).run();
    const instrument = await quotePOST(quoteRequest({
      items: [{ productId: 'prod_ab', name: '离心机耗材', price: 100, quantity: 80 }],
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(instrument.status).toBe(200);
  });

  it('rejects an invalid order line price and leaves the row unchanged', async () => {
    const response = await orderPATCH(orderRequest({
      items: [{ productId: 'prod_ab', name: '抗体A', price: 'abc', quantity: 1 }],
    }), { params: Promise.resolve({ id: 'o1' }) });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('COMMERCE_LINE_INVALID');
    expect(getTestDb().prepare('SELECT unitPrice FROM OrderItem').get()).toEqual({ unitPrice: 100 });
  });

  it('saves an order line after the admin confirms a large consumable quantity', async () => {
    getTestDb().prepare(`UPDATE Product SET category = '材料合成', price = 20 WHERE id = 'prod_ab'`).run();
    getTestDb().prepare(`DELETE FROM AdminRolePermission WHERE permissionId = 'perm_pricing_write'`).run();
    const items = [{ productId: 'prod_ab', name: '吸头', price: 20, quantity: 51 }];
    const blocked = await orderPATCH(orderRequest({ items }), { params: Promise.resolve({ id: 'o1' }) });
    expect(blocked.status).toBe(409);
    expect(getTestDb().prepare('SELECT quantity FROM OrderItem').get()).toEqual({ quantity: 1 });

    const confirmed = await orderPATCH(orderRequest({ items, confirmWarnings: true }), { params: Promise.resolve({ id: 'o1' }) });
    expect(confirmed.status).toBe(200);
    expect(getTestDb().prepare('SELECT unitPrice, quantity FROM OrderItem').get()).toEqual({ unitPrice: 20, quantity: 51 });
    const audit = getTestDb().prepare(`SELECT action, metadata FROM AuditLog WHERE action = 'order.line_warnings_confirmed'`).get() as { action: string; metadata: string };
    expect(JSON.parse(audit.metadata).warnings[0].code).toBe('quantity_abnormally_large');
    const event = getTestDb().prepare(`SELECT metadata FROM OrderEvent WHERE type = 'items_updated'`).get() as { metadata: string };
    expect(JSON.parse(event.metadata).confirmedWarnings[0].code).toBe('quantity_abnormally_large');
  });

  it('persists a numeric price string instead of storing zero', async () => {
    const response = await orderPATCH(orderRequest({
      items: [{ productId: 'prod_ab', name: '抗体A', price: '100', quantity: '2' }],
    }), { params: Promise.resolve({ id: 'o1' }) });
    expect(response.status).toBe(200);
    expect(getTestDb().prepare('SELECT unitPrice, quantity FROM OrderItem').get()).toEqual({ unitPrice: 100, quantity: 2 });
  });

  it('does not treat confirmWarnings as permission to save a zero quantity', async () => {
    const response = await orderPATCH(orderRequest({
      items: [{ productId: 'prod_ab', name: '抗体A', price: 100, quantity: 0, confirmWarnings: true }],
      confirmWarnings: true,
    }), { params: Promise.resolve({ id: 'o1' }) });
    expect(response.status).toBe(400);
    expect(getTestDb().prepare('SELECT quantity FROM OrderItem').get()).toEqual({ quantity: 1 });
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM AuditLog').get()).toEqual({ count: 0 });
  });
});
