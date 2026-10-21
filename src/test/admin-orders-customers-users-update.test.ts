import { describe, it, expect, beforeAll, beforeEach, vi, afterAll } from 'vitest';

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

import { GET as ordersGET, POST as ordersPOST } from '@/app/api/admin/orders/route';
import { GET as customersGET } from '@/app/api/admin/customers/route';
import { PUT as userUpdatePUT } from '@/app/api/admin/users/update/route';
import { NextRequest } from 'next/server';
import { getTestDb, closeTestDb, seedUser, seedAdmin, clearAllTables } from './db-helpers';

function seedOrder(db: ReturnType<typeof getTestDb>, order: {
  id: string;
  email: string;
  status?: string;
  archivedAt?: string | null;
}) {
  db.prepare(`
    INSERT INTO "Order" (id, email, subtotal, status, shippingMethod, operationLogs, createdAt, updatedAt, archivedAt)
    VALUES (?, ?, 100, ?, 'logistics', '[]', datetime('now'), datetime('now'), ?)
  `).run(order.id, order.email, order.status ?? 'pending', order.archivedAt ?? null);
}

describe('GET /api/admin/orders (list)', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedOrder(db, { id: 'o1', email: 'u1@test.com' });
    seedOrder(db, { id: 'o2', email: 'u2@test.com', status: 'shipped' });
    seedOrder(db, { id: 'o3', email: 'u3@test.com', status: 'shipped' });
    seedOrder(db, { id: 'o4', email: 'u4@test.com', archivedAt: new Date().toISOString() });
  });

  it('returns the first page of non-archived orders, newest first', async () => {
    const db = getTestDb();
    db.prepare(`UPDATE "Order" SET createdAt = ? WHERE id = 'o1'`).run('2026-03-01T00:00:00.000Z');
    db.prepare(`UPDATE "Order" SET createdAt = ? WHERE id = 'o2'`).run('2026-03-02T00:00:00.000Z');
    db.prepare(`UPDATE "Order" SET createdAt = ? WHERE id = 'o3'`).run('2026-03-03T00:00:00.000Z');
    const res = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders') as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.orders).toHaveLength(3); // o4 archived excluded
    expect(json.page).toBe(1);
    expect(json.pageSize).toBe(20);
    expect(json.total).toBe(3);
    expect(json.orders.map((order: { id: string }) => order.id)).toEqual(['o3', 'o2', 'o1']);
    expect(json.orders[0]).not.toHaveProperty('items');
    expect(json.orders[0]).not.toHaveProperty('orderItems');
    expect(json.orders[0]).not.toHaveProperty('events');
    expect(json.orders[0]).not.toHaveProperty('shipments');
  });

  it('filters by status', async () => {
    const res = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?status=shipped') as NextRequest);
    const json = await res.json();
    expect(json.orders).toHaveLength(2);
    expect(json.total).toBe(2);
    expect(json.orders.every((o: { status: string }) => o.status === 'shipped')).toBe(true);
  });

  it('enriches order with name/institution/phone from address snapshot', async () => {
    const db = getTestDb();
    db.prepare(`INSERT INTO OrderAddressSnapshot (id, orderId, name, institution, phone, address) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('snapshot_1', 'o1', '收货张三', '清华大学', '13800001111', '北京市海淀区');

    const res = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders') as NextRequest);
    const json = await res.json();
    const o1 = json.orders.find((o: { id: string }) => o.id === 'o1');
    expect(o1.name).toBe('收货张三');
    expect(o1.institution).toBe('清华大学');
    expect(o1.phone).toBe('13800001111');
    expect(o1).not.toHaveProperty('addressSnapshot');
  });

  it('paginates and keeps archived orders out of later pages', async () => {
    const db = getTestDb();
    const insert = db.prepare(`
      INSERT INTO "Order" (id, email, subtotal, status, shippingMethod, operationLogs, createdAt, updatedAt, archivedAt)
      VALUES (?, ?, 100, 'pending', 'logistics', '[]', ?, datetime('now'), NULL)
    `);
    for (let index = 0; index < 22; index += 1) {
      const createdAt = `2026-02-${String((index % 27) + 1).padStart(2, '0')}T00:00:00.000Z`;
      insert.run(`extra-${index}`, `extra-${index}@test.com`, createdAt);
    }

    const first = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?page=1&pageSize=20') as NextRequest);
    const firstJson = await first.json();
    expect(firstJson.orders).toHaveLength(20);
    expect(firstJson.total).toBe(25);
    expect(firstJson.orders.some((order: { id: string }) => order.id === 'o4')).toBe(false);

    const second = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?page=2&pageSize=20') as NextRequest);
    const secondJson = await second.json();
    expect(secondJson.orders).toHaveLength(5);
    expect(secondJson.page).toBe(2);
    const seen = new Set([
      ...firstJson.orders.map((order: { id: string }) => order.id),
      ...secondJson.orders.map((order: { id: string }) => order.id),
    ]);
    expect(seen.size).toBe(25);
  });

  it('searches by order id, email, recipient name, and institution without changing status counts', async () => {
    const db = getTestDb();
    db.prepare(`INSERT INTO OrderAddressSnapshot (id, orderId, name, institution, phone, address) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('snapshot_search', 'o2', '李四', '北京大学', '13900002222', '北京市海淀区');

    const byName = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?q=李四') as NextRequest);
    const byNameJson = await byName.json();
    expect(byNameJson.orders.map((order: { id: string }) => order.id)).toEqual(['o2']);
    expect(byNameJson.total).toBe(1);
    expect(byNameJson.statusCounts.shipped).toBe(2);
    expect(byNameJson.statusCounts.pending).toBe(1);

    const byInstitution = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?q=北京大学') as NextRequest);
    expect((await byInstitution.json()).orders.map((order: { id: string }) => order.id)).toEqual(['o2']);

    const byEmail = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?q=u1@test.com') as NextRequest);
    expect((await byEmail.json()).orders.map((order: { id: string }) => order.id)).toEqual(['o1']);

    const byId = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?q=o3') as NextRequest);
    expect((await byId.json()).orders.map((order: { id: string }) => order.id)).toEqual(['o3']);
  });

  it('filters by Shanghai calendar dates', async () => {
    const db = getTestDb();
    db.prepare(`UPDATE "Order" SET createdAt = ? WHERE id = 'o1'`).run('2024-01-15T04:00:00.000Z');
    db.prepare(`UPDATE "Order" SET createdAt = ? WHERE id = 'o2'`).run('2024-01-15T16:00:00.000Z');

    const res = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?dateFrom=2024-01-15&dateTo=2024-01-15') as NextRequest);
    const json = await res.json();
    expect(json.orders.map((order: { id: string }) => order.id)).toEqual(['o1']);
    expect(json.total).toBe(1);
  });

  it('treats unpaid Alipay orders that are still pending as unpaid', async () => {
    const db = getTestDb();
    db.prepare(`UPDATE "Order" SET status = 'pending', paymentMethod = '支付宝', paidAt = NULL WHERE id = 'o1'`).run();
    db.prepare(`UPDATE "Order" SET status = 'pending', paymentMethod = 'bank_transfer', paidAt = NULL WHERE id = 'o2'`).run();

    const unpaid = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?status=unpaid') as NextRequest);
    const unpaidJson = await unpaid.json();
    expect(unpaidJson.orders.map((order: { id: string }) => order.id)).toEqual(['o1']);

    const pending = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?status=pending') as NextRequest);
    const pendingJson = await pending.json();
    expect(pendingJson.orders.map((order: { id: string }) => order.id)).toEqual(['o2']);
    expect(pendingJson.statusCounts.unpaid).toBe(1);
    expect(pendingJson.statusCounts.pending).toBe(1);
    expect(pendingJson.statusCounts.shipped).toBe(1);
  });

  it('limits the open-receivable view and summarizes every open receivable', async () => {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO AccountReceivable (id, orderId, userId, amount, status, confirmedAt, createdAt, updatedAt)
      VALUES (?, ?, 'admin_test_id', ?, ?, datetime('now'), datetime('now'), datetime('now'))
    `).run('ar-o1', 'o1', 120.5, 'open');
    db.prepare(`
      INSERT INTO AccountReceivable (id, orderId, userId, amount, status, confirmedAt, createdAt, updatedAt)
      VALUES (?, ?, 'admin_test_id', ?, ?, datetime('now'), datetime('now'), datetime('now'))
    `).run('ar-o2', 'o2', 30, 'paid');
    db.prepare(`
      INSERT INTO AccountReceivable (id, orderId, userId, amount, status, confirmedAt, createdAt, updatedAt)
      VALUES (?, ?, 'admin_test_id', ?, ?, datetime('now'), datetime('now'), datetime('now'))
    `).run('ar-o4', 'o4', 999, 'open');

    const res = await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?receivable=open&q=does-not-match') as NextRequest);
    const json = await res.json();
    expect(json.orders).toEqual([]);
    expect(json.total).toBe(0);
    expect(json.receivableSummary).toEqual({ count: 1, amount: 120.5 });
  });

  it('rejects invalid page, page size, and status', async () => {
    expect((await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?status=nope') as NextRequest)).status).toBe(400);
    expect((await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?page=0') as NextRequest)).status).toBe(400);
    expect((await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?pageSize=100') as NextRequest)).status).toBe(400);
    expect((await ordersGET(new NextRequest('http://localhost:3000/api/admin/orders?dateFrom=2024/01/01') as NextRequest)).status).toBe(400);
  });
});

describe('POST /api/admin/orders (admin create order)', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
  });

  function makeReq(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('stores product subtotal and fees as separate adjustments', async () => {
    const res = await ordersPOST(makeReq({
      customerEmail: 'cust@test.com',
      items: [
        { name: '产品A', price: 100, quantity: 2 },
        { name: '产品B', price: 50, quantity: 3 },
      ],
      platformFee: 10,
      transferFee: 5,
      paymentMethod: 'bank_transfer',
    }) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.orderId).toMatch(/^ORD-\d{8}-\d{3}$/);
    expect(json.order.subtotal).toBe(350);
    expect(json.order.adjustmentTotal).toBe(15);
    expect(json.order.total).toBe(365);

    const db = getTestDb();
    const o = db.prepare('SELECT email, customerId, subtotal, adjustmentTotal, total FROM "Order" WHERE id = ?').get(json.orderId) as { email: string; customerId: string | null; subtotal: number; adjustmentTotal: number; total: number };
    expect(o).toEqual({ email: 'cust@test.com', customerId: null, subtotal: 350, adjustmentTotal: 15, total: 365 });
  });

  it('attributes the order to the customer and stores the selected address', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'cust_1', email: 'buyer@lab.test', name: '李老师' });
    db.prepare(`INSERT INTO Address (id, userId, name, phone, address, institution, isDefault, createdAt, updatedAt)
      VALUES ('addr_1', 'cust_1', '李老师', '13800001111', '北京市海淀区学院路1号', '清华大学', 1, datetime('now'), datetime('now'))`).run();

    const res = await ordersPOST(makeReq({
      customerEmail: 'buyer@lab.test',
      addressId: 'addr_1',
      items: [{ name: '抗体A', productId: 'p1', catalogNumber: 'CST-1', price: 100, quantity: 2 }],
      paymentMethod: 'bank_transfer',
    }) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);

    const order = db.prepare('SELECT email, customerId FROM "Order" WHERE id = ?').get(json.orderId) as { email: string; customerId: string | null };
    expect(order).toEqual({ email: 'buyer@lab.test', customerId: 'cust_1' });
    expect(order.customerId).not.toBe('admin_test_id');
    const snapshot = db.prepare('SELECT sourceAddressId, name, phone, address, institution FROM OrderAddressSnapshot WHERE orderId = ?').get(json.orderId) as {
      sourceAddressId: string;
      name: string;
      phone: string;
      address: string;
      institution: string;
    };
    expect(snapshot).toEqual({
      sourceAddressId: 'addr_1',
      name: '李老师',
      phone: '13800001111',
      address: '北京市海淀区学院路1号',
      institution: '清华大学',
    });
  });

  it('rejects an address that belongs to another customer and does not create an order', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'cust_1', email: 'buyer@lab.test', name: '李老师' });
    seedUser(db, { id: 'cust_2', email: 'other@lab.test', name: '王老师' });
    db.prepare(`INSERT INTO Address (id, userId, name, phone, address, isDefault, createdAt, updatedAt)
      VALUES ('addr_2', 'cust_2', '王老师', '13900002222', '上海市杨浦区', 1, datetime('now'), datetime('now'))`).run();

    const res = await ordersPOST(makeReq({
      customerEmail: 'buyer@lab.test',
      addressId: 'addr_2',
      items: [{ name: '抗体A', price: 100, quantity: 1 }],
      paymentMethod: 'bank_transfer',
    }) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe('所选地址不属于该客户，请重新选择');
    const count = db.prepare('SELECT COUNT(*) AS count FROM "Order"').get() as { count: number };
    expect(count.count).toBe(0);
  });

  it('stores a typed address snapshot when no saved address is selected', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'cust_1', email: 'buyer@lab.test', name: '李老师' });
    const res = await ordersPOST(makeReq({
      customerEmail: 'buyer@lab.test',
      addressName: '收货人',
      addressPhone: '13700003333',
      addressText: '广州市天河区',
      addressInstitution: '中山大学',
      items: [{ name: '抗体A', price: 80, quantity: 1 }],
      paymentMethod: 'alipay',
    }) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    const snapshot = db.prepare('SELECT sourceAddressId, name, phone, address, institution FROM OrderAddressSnapshot WHERE orderId = ?').get(json.orderId);
    expect(snapshot).toEqual({
      sourceAddressId: null,
      name: '收货人',
      phone: '13700003333',
      address: '广州市天河区',
      institution: '中山大学',
    });
  });

  it('increments daily sequence (ORD-DATE-001 → ORD-DATE-002)', async () => {
    const res1 = await ordersPOST(makeReq({
      customerEmail: 'a@test.com',
      items: [{ name: 'X', price: 100, quantity: 1 }],
      paymentMethod: 'bank_transfer',
    }) as NextRequest);
    const res2 = await ordersPOST(makeReq({
      customerEmail: 'b@test.com',
      items: [{ name: 'X', price: 200, quantity: 1 }],
      paymentMethod: 'bank_transfer',
    }) as NextRequest);
    const id1 = (await res1.json()).orderId as string;
    const id2 = (await res2.json()).orderId as string;
    expect(id1).not.toBe(id2);
    // seq 应该递增（具体数字看时间，但一定不同）
    expect(id1.split('-').pop()).not.toBe(id2.split('-').pop());
  });

  it('keeps creating the order when points fields are sent and does not deduct the customer balance', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'cust_points', email: 'cust@test.com', points: 80 });
    const res = await ordersPOST(makeReq({
      customerEmail: 'cust@test.com',
      items: [{ name: '抗体A', price: 100, quantity: 1 }],
      paymentMethod: 'alipay',
      personalPoints: 20,
      groupPoints: 5,
      groupId: 'group-1',
    }) as NextRequest);
    expect(res.status).toBe(200);
    const json = await res.json();
    const order = db.prepare('SELECT customerId, pointsPersonal, pointsGroup, pointsDiscount, pointsApplied FROM "Order" WHERE id = ?').get(json.orderId);
    expect(order).toEqual({
      customerId: 'cust_points',
      pointsPersonal: 0,
      pointsGroup: 0,
      pointsDiscount: 0,
      pointsApplied: 0,
    });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('cust_points')).toEqual({ points: 80 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM PointsLog').get()).toEqual({ count: 0 });
  });

  it('returns 400 for empty items array', async () => {
    const res = await ordersPOST(makeReq({
      customerEmail: 'cust@test.com',
      items: [],
    }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing customerEmail', async () => {
    const res = await ordersPOST(makeReq({
      items: [{ name: 'X', price: 100, quantity: 1 }],
    }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('rejects a variant line when that variant does not have enough stock', async () => {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO Product (id, catalogNumber, name, brand, price, stockQuantity, applications, reactivity, createdAt, updatedAt)
      VALUES ('p_var', 'CAT-V', '规格抗体', 'CST', 100, -1, '[]', '[]', datetime('now'), datetime('now'))
    `).run();
    db.prepare(`INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price) VALUES ('variant_1', 'p_var', 'CAT-V-100', '100 µL', 100)`).run();
    db.prepare(`
      INSERT INTO InventoryAccount (id, productId, variantId, actualQuantity, availableQuantity, reservedQuantity, shippedQuantity, inboundQuantity, createdAt, updatedAt)
      VALUES ('acc_var', 'p_var', 'variant_1', 1, 1, 0, 0, 0, datetime('now'), datetime('now'))
    `).run();

    const res = await ordersPOST(makeReq({
      customerEmail: 'cust@test.com',
      items: [{ productId: 'p_var', catalogNumber: 'CAT-V-100', variantId: 'variant_1', name: '规格抗体', price: 100, quantity: 2 }],
      paymentMethod: 'bank_transfer',
    }) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json).toMatchObject({ error: '所选规格库存不足', code: 'VARIANT_INSUFFICIENT_STOCK' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM "Order"').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT availableQuantity, reservedQuantity FROM InventoryAccount WHERE id = ?').get('acc_var')).toEqual({
      availableQuantity: 1,
      reservedQuantity: 0,
    });
  });

  it('reserves the selected variant when an admin order is created', async () => {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO Product (id, catalogNumber, name, brand, price, stockQuantity, applications, reactivity, createdAt, updatedAt)
      VALUES ('p_var', 'CAT-V', '规格抗体', 'CST', 100, -1, '[]', '[]', datetime('now'), datetime('now'))
    `).run();
    db.prepare(`INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price) VALUES ('variant_1', 'p_var', 'CAT-V-100', '100 µL', 100)`).run();
    db.prepare(`
      INSERT INTO InventoryAccount (id, productId, variantId, actualQuantity, availableQuantity, reservedQuantity, shippedQuantity, inboundQuantity, createdAt, updatedAt)
      VALUES ('acc_var', 'p_var', 'variant_1', 2, 2, 0, 0, 0, datetime('now'), datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO InventoryAccount (id, productId, variantId, actualQuantity, availableQuantity, reservedQuantity, shippedQuantity, inboundQuantity, createdAt, updatedAt)
      VALUES ('acc_product', 'p_var', NULL, 9, 9, 0, 0, 0, datetime('now'), datetime('now'))
    `).run();

    const res = await ordersPOST(makeReq({
      customerEmail: 'cust@test.com',
      items: [{ productId: 'p_var', catalogNumber: 'CAT-V-100', variantId: 'variant_1', name: '规格抗体', price: 100, quantity: 1 }],
      paymentMethod: 'bank_transfer',
    }) as NextRequest);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT availableQuantity, reservedQuantity FROM InventoryAccount WHERE id = ?').get('acc_var')).toEqual({
      availableQuantity: 1,
      reservedQuantity: 1,
    });
    expect(db.prepare('SELECT availableQuantity, reservedQuantity FROM InventoryAccount WHERE id = ?').get('acc_product')).toEqual({
      availableQuantity: 9,
      reservedQuantity: 0,
    });
    expect(db.prepare('SELECT stockQuantity FROM Product WHERE id = ?').get('p_var')).toEqual({ stockQuantity: -1 });
  });

  it('still creates an order for a product without variants when product stock is zero', async () => {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO Product (id, catalogNumber, name, brand, price, stockQuantity, applications, reactivity, createdAt, updatedAt)
      VALUES ('p_plain', 'CAT-PLAIN', '无规格试剂', 'CST', 80, 0, '[]', '[]', datetime('now'), datetime('now'))
    `).run();
    const res = await ordersPOST(makeReq({
      customerEmail: 'cust@test.com',
      items: [{ productId: 'p_plain', catalogNumber: 'CAT-PLAIN', name: '无规格试剂', price: 80, quantity: 1 }],
      paymentMethod: 'bank_transfer',
    }) as NextRequest);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS count FROM InventoryReservation').get()).toEqual({ count: 0 });
  });
});

describe('GET /api/admin/customers', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'u1', email: 'u1@test.com', name: '客户一' });
    seedUser(db, { id: 'u2', email: 'u2@test.com', name: '客户二' });
  });

  it('returns only customers (excludes admin)', async () => {
    const res = await customersGET();
    const json = await res.json();
    expect(res.status).toBe(200);
    // admin 已 WHERE role='customer' 过滤；route 不 select role 字段，只看数量
    expect(json.customers).toHaveLength(2);
    expect(json.customers.every((c: { email: string }) => ['u1@test.com', 'u2@test.com'].includes(c.email))).toBe(true);
  });

  it('includes user addresses in result', async () => {
    const db = getTestDb();
    db.prepare(`INSERT INTO Address (id, userId, name, phone, address, isDefault, createdAt, updatedAt)
                VALUES ('a1', 'u1', '收货', '138', '北京', 1, datetime('now'), datetime('now'))`).run();

    const res = await customersGET();
    const json = await res.json();
    const u1 = json.customers.find((c: { id: string }) => c.id === 'u1');
    expect(u1.addresses).toHaveLength(1);
    expect(u1.addresses[0].name).toBe('收货');
  });

  it('parses brandDiscounts JSON to object', async () => {
    const db = getTestDb();
    db.prepare('UPDATE User SET brandDiscounts = ? WHERE id = ?').run('{"CST":0.85}', 'u1');

    const res = await customersGET();
    const json = await res.json();
    const u1 = json.customers.find((c: { id: string }) => c.id === 'u1');
    expect(u1.brandDiscounts).toEqual({ CST: 0.85 });
  });
});

describe('PUT /api/admin/users/update', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'u1', email: 'u1@test.com', points: 100 });
  });

  function makeReq(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/users/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('updates discountRate to valid value 0.85', async () => {
    const res = await userUpdatePUT(makeReq({ userId: 'u1', discountRate: 0.85 }) as NextRequest);
    expect(res.status).toBe(200);

    const db = getTestDb();
    const u1 = db.prepare('SELECT discountRate FROM User WHERE id = ?').get('u1') as { discountRate: number };
    expect(u1.discountRate).toBe(0.85);
  });

  it('rejects discountRate > 2 (max=2 边界)', async () => {
    const res = await userUpdatePUT(makeReq({ userId: 'u1', discountRate: 3 }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('clears discountRate when set to null', async () => {
    const db = getTestDb();
    db.prepare('UPDATE User SET discountRate = 0.9 WHERE id = ?').run('u1');

    const res = await userUpdatePUT(makeReq({ userId: 'u1', discountRate: null }) as NextRequest);
    expect(res.status).toBe(200);

    const u1 = db.prepare('SELECT discountRate FROM User WHERE id = ?').get('u1') as { discountRate: number | null };
    expect(u1.discountRate).toBeNull();
  });

  it('updates brandDiscounts JSON object', async () => {
    const res = await userUpdatePUT(makeReq({
      userId: 'u1',
      brandDiscounts: { CST: 0.85, Abcam: 0.9 },
    }) as NextRequest);
    expect(res.status).toBe(200);

    const db = getTestDb();
    const u1 = db.prepare('SELECT brandDiscounts FROM User WHERE id = ?').get('u1') as { brandDiscounts: string };
    expect(JSON.parse(u1.brandDiscounts)).toEqual({ CST: 0.85, Abcam: 0.9 });
  });

  it('rejects brandDiscounts with rate > 2', async () => {
    const res = await userUpdatePUT(makeReq({
      userId: 'u1',
      brandDiscounts: { Bad: 5 },
    }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('updates points + writes PointsLog with delta', async () => {
    // u1 现有 100, 设 250 → delta=150
    const res = await userUpdatePUT(makeReq({ userId: 'u1', points: 250 }) as NextRequest);
    expect(res.status).toBe(200);

    const db = getTestDb();
    const u1 = db.prepare('SELECT points FROM User WHERE id = ?').get('u1') as { points: number };
    expect(u1.points).toBe(250);
    const log = db.prepare('SELECT * FROM PointsLog WHERE userId = ?').get('u1') as { delta: number; type: string };
    expect(log.delta).toBe(150);
    expect(log.type).toBe('admin_adjust');
  });

  it('rejects a points balance above the shared maximum', async () => {
    const res = await userUpdatePUT(makeReq({ userId: 'u1', points: 1000001 }) as NextRequest);
    expect(res.status).toBe(400);
    expect(getTestDb().prepare('SELECT points FROM User WHERE id = ?').get('u1')).toEqual({ points: 100 });
  });

  it('updates isNewUser=false → sends approval notification', async () => {
    const res = await userUpdatePUT(makeReq({ userId: 'u1', isNewUser: false }) as NextRequest);
    expect(res.status).toBe(200);

    const db = getTestDb();
    const u1 = db.prepare('SELECT isNewUser FROM User WHERE id = ?').get('u1') as { isNewUser: number };
    expect(u1.isNewUser).toBe(0);

    const notifs = db.prepare('SELECT * FROM Notification WHERE email = ?').all('u1@test.com') as Array<{ title: string }>;
    expect(notifs).toHaveLength(1);
    expect(notifs[0].title).toMatch(/审核/);
  });

  it('returns 404 for non-existent user', async () => {
    const res = await userUpdatePUT(makeReq({ userId: 'nonexistent', discountRate: 0.9 }) as NextRequest);
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing userId', async () => {
    const res = await userUpdatePUT(makeReq({ discountRate: 0.9 }) as NextRequest);
    expect(res.status).toBe(400);
  });
});
