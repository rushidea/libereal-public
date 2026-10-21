import { describe, it, expect, beforeAll, beforeEach, vi, afterAll } from 'vitest';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));

import { GET as inquiriesGET } from '@/app/api/inquiries/route';
import { POST as quotePOST } from '@/app/api/inquiries/[id]/quote/route';
import { POST as confirmQuotePOST } from '@/app/api/orders/[id]/confirm-items/route';
import { PATCH as archivePATCH } from '@/app/api/admin/inquiries/archive/route';
import { GET as archivedGET } from '@/app/api/admin/inquiries/archived/route';
import { NextRequest } from 'next/server';
import { getTestDb, closeTestDb, seedAdmin, seedUser, clearAllTables } from './db-helpers';
import { calculateOrderPoints } from '@/lib/points';

function seedInquiry(db: ReturnType<typeof getTestDb>, inquiry: {
  id: string;
  name: string;
  email: string;
  phone?: string;
  institution?: string;
  items?: string;
  status?: string;
  archivedAt?: string | null;
}) {
  db.prepare(`
    INSERT INTO Inquiry (id, name, email, phone, institution, status, archivedAt, createdAt, operationLogs)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), '[]')
  `).run(
    inquiry.id,
    inquiry.name,
    inquiry.email,
    inquiry.phone ?? '13800000000',
    inquiry.institution ?? '清华大学',
    inquiry.status ?? 'pending_quote',
    inquiry.archivedAt ?? null,
  );
  const items = JSON.parse(inquiry.items ?? JSON.stringify([{ productId: 'p1', name: 'A', price: 100, quantity: 1 }])) as Array<{
    productId?: string; name: string; price: number; quantity: number; metadata?: Record<string, unknown>;
  }>;
  const insertItem = db.prepare(`
    INSERT INTO InquiryItem (id, inquiryId, position, productId, name, unitPrice, quantity, lineTotal, metadata, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  items.forEach((item, position) => insertItem.run(
    `${inquiry.id}_item_${position}`,
    inquiry.id,
    position,
    item.productId ?? null,
    item.name,
    item.price,
    item.quantity,
    item.price * item.quantity,
    item.metadata ? JSON.stringify(item.metadata) : null,
  ));
}

describe('GET /api/inquiries (admin list)', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedInquiry(db, { id: 'i1', name: '张一', email: 'z1@test.com' });
    seedInquiry(db, { id: 'i2', name: '张二', email: 'z2@test.com', status: 'quote_sent' });
    seedInquiry(db, { id: 'i3', name: '张三', email: 'z3@test.com', archivedAt: new Date().toISOString() });
  });

  it('returns non-archived inquiries, newest first', async () => {
    const res = await inquiriesGET(new NextRequest('http://localhost:3000/api/inquiries') as NextRequest);
    expect(res.status).toBe(200);
    const arr = await res.json();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(2); // i3 archived excluded
    expect(arr.every((i: { archivedAt: string | null }) => i.archivedAt === null)).toBe(true);
  });

  it('returns null activeQuote before a quote is created', async () => {
    const res = await inquiriesGET(new NextRequest('http://localhost:3000/api/inquiries') as NextRequest);
    const arr = await res.json();
    const i2 = arr.find((i: { id: string }) => i.id === 'i2');
    expect(i2.activeQuote).toBeNull();
  });

  it('returns customer contact details and the requested lead time for administrators', async () => {
    const db = getTestDb();
    db.prepare('UPDATE Inquiry SET department = ?, address = ?, notes = ?, paymentMethod = ? WHERE id = ?')
      .run('生命科学学院', '北京市海淀区实验路 1 号', '请分批报价', '对公转账', 'i1');
    db.prepare('UPDATE InquiryItem SET metadata = ? WHERE inquiryId = ?')
      .run(JSON.stringify({ customerLeadTime: '14 天' }), 'i1');

    const response = await inquiriesGET(new NextRequest('http://localhost:3000/api/inquiries') as NextRequest);
    const inquiries = await response.json() as Array<{
      id: string;
      department?: string;
      address?: string;
      notes?: string;
      paymentMethod?: string;
      items: Array<{ customerLeadTime?: string | null }>;
    }>;
    const inquiry = inquiries.find((item) => item.id === 'i1');

    expect(inquiry).toMatchObject({
      department: '生命科学学院',
      address: '北京市海淀区实验路 1 号',
      notes: '请分批报价',
      paymentMethod: '对公转账',
    });
    expect(inquiry?.items[0]?.customerLeadTime).toBe('14 天');
  });
});

describe('POST /api/inquiries/[id]/quote (admin send quote)', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedInquiry(db, { id: 'i1', name: '询价人', email: 'q@test.com' });
  });

  function makeReq(id: string, body: object = {}): NextRequest {
    return new NextRequest(`http://localhost:3000/api/inquiries/${id}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('sends quote version 1 and sends notification', async () => {
    const res = await quotePOST(makeReq('i1') as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);

    const db = getTestDb();
    const i1 = db.prepare('SELECT status FROM Inquiry WHERE id = ?').get('i1') as { status: string };
    expect(i1.status).toBe('quote_sent');
    const quote = db.prepare('SELECT version, status, subtotal FROM Quote WHERE inquiryId = ?').get('i1') as { version: number; status: string; subtotal: number };
    expect(quote).toMatchObject({ version: 1, status: 'sent', subtotal: 100 });

    const notifs = db.prepare('SELECT * FROM Notification WHERE email = ?').all('q@test.com') as Array<{ type: string; title: string }>;
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe('quote_received');
    expect(notifs[0].title).toMatch(/报价/);
    const tasks = db.prepare('SELECT type, status, dedupeKey FROM BackgroundTask ORDER BY type').all() as Array<{ type: string; status: string; dedupeKey: string }>;
    expect(tasks).toEqual([
      expect.objectContaining({ type: 'email.send', status: 'pending' }),
      expect.objectContaining({ type: 'quote.expire', status: 'pending' }),
    ]);
  });

  it('updates items with priced versions', async () => {
    const newItems = [{ productId: 'p1', name: 'A', price: 200, quantity: 2 }];
    const res = await quotePOST(makeReq('i1', { items: newItems }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    expect(res.status).toBe(200);

    const db = getTestDb();
    const items = db.prepare('SELECT productId, name, unitPrice, quantity FROM QuoteItem WHERE quoteId = (SELECT id FROM Quote WHERE inquiryId = ?) ORDER BY position')
      .all('i1') as Array<{ productId: string; name: string; unitPrice: number; quantity: number }>;
    expect(items).toEqual([{ productId: 'p1', name: 'A', unitPrice: 200, quantity: 2 }]);
  });

  it('uses the inquiry item brand metadata when quoting a shared catalog number', async () => {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO Product (id, catalogNumber, name, brand, price, applications, reactivity, createdAt, updatedAt)
      VALUES
        ('product_cst', 'CAT-1', 'CST Product', 'CST', 1000, '[]', '[]', datetime('now'), datetime('now')),
        ('product_ms', 'CAT-1', 'MultiSciences Product', 'MultiSciences', 1200, '[]', '[]', datetime('now', '+1 second'), datetime('now'))
    `).run();
    db.prepare(`
      UPDATE InquiryItem
      SET productId = NULL, catalogNumber = ?, name = ?, unitPrice = ?, lineTotal = ?, metadata = ?
      WHERE inquiryId = ?
    `).run('CAT-1', 'MultiSciences Product', 1, 1, JSON.stringify({ brand: 'MultiSciences' }), 'i1');

    const res = await quotePOST(makeReq('i1', {
      items: [{ catalogNumber: 'CAT-1', name: 'MultiSciences Product', quantity: 1 }],
    }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });

    expect(res.status).toBe(200);
    const quoteItem = db.prepare('SELECT productId, catalogNumber, unitPrice FROM QuoteItem WHERE quoteId = (SELECT id FROM Quote WHERE inquiryId = ?)')
      .get('i1') as { productId: string; catalogNumber: string; unitPrice: number };
    expect(quoteItem).toEqual({ productId: 'product_ms', catalogNumber: 'CAT-1', unitPrice: 1200 });
  });

  it('creates a new version and supersedes the previous quote', async () => {
    await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'A', price: 100, quantity: 1 }] }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    const response = await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'A', price: 120, quantity: 1 }] }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    expect(response.status).toBe(200);

    const quotes = getTestDb().prepare('SELECT version, status, subtotal FROM Quote WHERE inquiryId = ? ORDER BY version')
      .all('i1') as Array<{ version: number; status: string; subtotal: number }>;
    expect(quotes).toEqual([
      { version: 1, status: 'superseded', subtotal: 100 },
      { version: 2, status: 'sent', subtotal: 120 },
    ]);
  });

  it('records quote acceptance and creates an order from the quote snapshot', async () => {
    await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'A', price: 150, quantity: 2 }] }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    const request = new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIndices: [0], quantities: { 0: 2 } }),
    });
    const response = await confirmQuotePOST(request, { params: Promise.resolve({ id: 'i1' }) });
    expect(response.status).toBe(200);

    const db = getTestDb();
    const quote = db.prepare('SELECT status, acceptedAt FROM Quote WHERE inquiryId = ?').get('i1') as { status: string; acceptedAt: string | null };
    expect(quote.status).toBe('accepted');
    expect(quote.acceptedAt).not.toBeNull();
    const confirmation = db.prepare('SELECT action, email FROM QuoteConfirmation').get() as { action: string; email: string };
    expect(confirmation).toEqual({ action: 'accept', email: 'admin@test.com' });
    const orderItem = db.prepare('SELECT unitPrice, quantity, quotedQuantity FROM OrderItem').get() as { unitPrice: number; quantity: number; quotedQuantity: number };
    expect(orderItem).toEqual({ unitPrice: 150, quantity: 2, quotedQuantity: 2 });
  });

  it('round trips variant, spec, and unit metadata from inquiry to quote to order', async () => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedInquiry(db, {
      id: 'metadata-inquiry',
      name: '元数据客户',
      email: 'metadata@test.com',
      items: JSON.stringify([{
        productId: 'p1', name: 'A 规格', price: 150, quantity: 2,
        metadata: { variantId: 'variant-10ml', spec: '10 mL', unit: '盒' },
      }]),
    });

    const quoteResponse = await quotePOST(makeReq('metadata-inquiry', {
      items: [{ productId: 'p1', name: 'A 规格', price: 150, quantity: 2 }],
    }) as NextRequest, { params: Promise.resolve({ id: 'metadata-inquiry' }) });
    expect(quoteResponse.status).toBe(200);
    const quoteItem = db.prepare('SELECT metadata FROM QuoteItem WHERE quoteId = (SELECT id FROM Quote WHERE inquiryId = ?)')
      .get('metadata-inquiry') as { metadata: string | null };
    expect(JSON.parse(quoteItem.metadata ?? '{}')).toMatchObject({ variantId: 'variant-10ml', spec: '10 mL', unit: '盒' });

    const confirmResponse = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/metadata-inquiry/confirm-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIndices: [0], quantities: { 0: 2 } }),
    }), { params: Promise.resolve({ id: 'metadata-inquiry' }) });
    expect(confirmResponse.status).toBe(200);
    const orderItem = db.prepare('SELECT metadata FROM OrderItem LIMIT 1').get() as { metadata: string | null };
    expect(JSON.parse(orderItem.metadata ?? '{}')).toMatchObject({ variantId: 'variant-10ml', spec: '10 mL', unit: '盒' });
  });

  it('rejects duplicate item indices before changing quote quantities', async () => {
    await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'A', price: 150, quantity: 2 }] }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    const response = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIndices: [0, 0], quantities: { 0: 1 } }),
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(response.status).toBe(400);
    expect(getTestDb().prepare('SELECT orderedQty FROM QuoteItem WHERE quoteId = (SELECT id FROM Quote WHERE inquiryId = ?)').get('i1')).toEqual({ orderedQty: 0 });
  });

  it('replays keyed confirmation after quota consumption for the delegate actor', async () => {
    await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'A', price: 150, quantity: 1 }] }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    const body = { itemIndices: [0], quantities: { 0: 1 }, acceptanceAttemptId: 'delegate-confirm-1' };
    const makeConfirm = () => new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const first = await confirmQuotePOST(makeConfirm(), { params: Promise.resolve({ id: 'i1' }) });
    expect(first.status).toBe(200);
    const replay = await confirmQuotePOST(makeConfirm(), { params: Promise.resolve({ id: 'i1' }) });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true });
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM "Order"').get()).toEqual({ count: 1 });
    expect(getTestDb().prepare('SELECT orderedQty FROM QuoteItem WHERE quoteId = (SELECT id FROM Quote WHERE inquiryId = ?)').get('i1')).toEqual({ orderedQty: 1 });
  });

  it('rejects the whole stale selection when one requested line was already accepted', async () => {
    await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'Synthetic A', price: 150, quantity: 1 }, { name: 'Synthetic B', price: 20, quantity: 1 }] }) as NextRequest, { params: Promise.resolve({ id: 'i1' }) });
    const db = getTestDb();
    db.prepare('UPDATE QuoteItem SET orderedQty = quantity WHERE position = 0').run();
    const response = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemIndices: [0, 1], acceptanceAttemptId: 'stale-selection-key' }) }), { params: Promise.resolve({ id: 'i1' }) });
    expect(response.status).toBe(409);
    expect(db.prepare('SELECT COUNT(*) AS count FROM "Order"').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT orderedQty FROM QuoteItem WHERE position = 1').get()).toEqual({ orderedQty: 0 });
  });

  it('returns a version conflict for stale quote identity and changed quantity', async () => {
    await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'A', price: 150, quantity: 2 }] }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    const quote = getTestDb().prepare('SELECT id, version FROM Quote WHERE inquiryId = ?').get('i1') as { id: string; version: number };
    const stale = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIndices: [0], quantities: { 0: 2 }, quoteId: 'stale-quote', quoteVersion: quote.version }),
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(stale.status).toBe(409);

    getTestDb().prepare('UPDATE QuoteItem SET orderedQty = 1 WHERE quoteId = ?').run(quote.id);
    const changedQuantity = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIndices: [0], quantities: { 0: 2 }, quoteId: quote.id, quoteVersion: quote.version }),
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(changedQuantity.status).toBe(200);
    expect(getTestDb().prepare('SELECT quantity, quotedQuantity FROM OrderItem').get()).toEqual({ quantity: 2, quotedQuantity: 2 });
    expect(getTestDb().prepare('SELECT orderedQty FROM QuoteItem WHERE quoteId = ?').get(quote.id)).toEqual({ orderedQty: 2 });
  });

  it('accepts a lower quantity and keeps the quoted quantity for audit', async () => {
    await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'A', price: 1000, quantity: 2 }] }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    const quoteRow = getTestDb().prepare('SELECT id FROM Quote WHERE inquiryId = ?').get('i1') as { id: string };
    const response = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIndices: [0], quantities: { 0: 1 }, quoteId: quoteRow.id, quoteVersion: 1, acceptanceAttemptId: 'accept-lower-1' }),
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(response.status).toBe(200);
    const db = getTestDb();
    expect(db.prepare('SELECT subtotal, total FROM "Order"').get()).toEqual({ subtotal: 1000, total: 1000 });
    expect(db.prepare('SELECT quantity, quotedQuantity, unitPrice FROM OrderItem').get()).toEqual({ quantity: 1, quotedQuantity: 2, unitPrice: 1000 });
    expect(db.prepare('SELECT quantity, orderedQty FROM QuoteItem').get()).toEqual({ quantity: 2, orderedQty: 1 });
    const confirmation = db.prepare('SELECT action, details FROM QuoteConfirmation').get() as { action: string; details: string };
    expect(confirmation.action).toBe('partial_accept');
    expect(JSON.parse(confirmation.details).items[0]).toMatchObject({ quotedQuantity: 2, orderedQuantity: 1, quantity: 1 });
    const event = db.prepare('SELECT metadata FROM OrderEvent').get() as { metadata: string };
    const metadata = JSON.parse(event.metadata) as { pointsBasisAmount: number; earnablePoints: number; pointsRedeemed: number };
    expect(metadata.pointsBasisAmount).toBe(1000);
    expect(metadata.earnablePoints).toBe(calculateOrderPoints(1000));
    expect(metadata.pointsRedeemed).toBe(0);
  });

  it('accepts a quantity above the quote and caps ordered quantity', async () => {
    await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'A', price: 150, quantity: 2 }] }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    const quoteRow = getTestDb().prepare('SELECT id FROM Quote WHERE inquiryId = ?').get('i1') as { id: string };
    const over = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIndices: [0], quantities: { 0: 5 }, quoteId: quoteRow.id, quoteVersion: 1, acceptanceAttemptId: 'accept-over' }),
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(over.status).toBe(200);
    const db = getTestDb();
    expect(db.prepare('SELECT subtotal, total FROM "Order"').get()).toEqual({ subtotal: 750, total: 750 });
    expect(db.prepare('SELECT quantity, quotedQuantity FROM OrderItem').get()).toEqual({ quantity: 5, quotedQuantity: 2 });
    expect(db.prepare('SELECT quantity, orderedQty FROM QuoteItem').get()).toEqual({ quantity: 2, orderedQty: 2 });
    expect(db.prepare('SELECT status FROM Quote WHERE id = ?').get(quoteRow.id)).toEqual({ status: 'accepted' });
  });

  it('omits removed lines and enforces quote package constraints', async () => {
    await quotePOST(makeReq('i1', {
      items: [
        { productId: 'p1', name: 'A', price: 10, quantity: 4 },
        { productId: 'p2', name: 'B', price: 20, quantity: 1 },
      ],
    }) as NextRequest, { params: Promise.resolve({ id: 'i1' }) });
    const db = getTestDb();
    const quoteRow = db.prepare('SELECT id FROM Quote WHERE inquiryId = ?').get('i1') as { id: string };
    db.prepare('UPDATE QuoteItem SET metadata = ? WHERE name = ?').run(JSON.stringify({ minQuantity: 2, quantityStep: 2 }), 'A');
    const invalid = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIndices: [0], quantities: { 0: 1 }, quoteId: quoteRow.id, quoteVersion: 1, acceptanceAttemptId: 'accept-moq' }),
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(invalid.status).toBe(400);
    const response = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIndices: [0], quantities: { 0: 2 }, quoteId: quoteRow.id, quoteVersion: 1, acceptanceAttemptId: 'accept-partial-line' }),
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(response.status).toBe(200);
    expect(db.prepare('SELECT name, quantity FROM OrderItem').all()).toEqual([{ name: 'A', quantity: 2 }]);
    expect(db.prepare('SELECT status FROM Quote WHERE id = ?').get(quoteRow.id)).toEqual({ status: 'sent' });
  });

  it('accepts Alipay and public-policy fees for a quote-converted order', async () => {
    await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'A', price: 150, quantity: 2 }] }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    const quoteRow = getTestDb().prepare('SELECT id FROM Quote WHERE inquiryId = ?').get('i1') as { id: string };
    const alipay = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIndices: [0], quantities: { 0: 2 }, quoteId: quoteRow.id, quoteVersion: 1, acceptanceAttemptId: 'accept-alipay', paymentMethod: '支付宝' }),
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(alipay.status).toBe(200);
    expect(getTestDb().prepare('SELECT paymentMethod, status, total, adjustmentTotal FROM "Order"').get()).toEqual({
      paymentMethod: 'alipay', status: 'unpaid', total: 300, adjustmentTotal: 0,
    });
  });

  it('rejects an unknown payment method on quote conversion', async () => {
    await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'A', price: 150, quantity: 2 }] }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    const quoteRow = getTestDb().prepare('SELECT id FROM Quote WHERE inquiryId = ?').get('i1') as { id: string };
    const response = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIndices: [0], quantities: { 0: 2 }, quoteId: quoteRow.id, quoteVersion: 1, acceptanceAttemptId: 'accept-weixin', paymentMethod: '微信支付' }),
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: '请选择有效的付款方式' });
  });

  it('rejects admin point redemption without creating an order or spending customer points', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'buyer_points', email: 'buyer-points@test.com', points: 40 });
    db.prepare('UPDATE Inquiry SET userId = ? WHERE id = ?').run('buyer_points', 'i1');
    await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'A', price: 150, quantity: 2 }] }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    const quoteRow = db.prepare('SELECT id FROM Quote WHERE inquiryId = ?').get('i1') as { id: string };
    const personal = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemIndices: [0], quantities: { 0: 2 }, quoteId: quoteRow.id, quoteVersion: 1,
        acceptanceAttemptId: 'accept-points-admin', paymentMethod: 'alipay', personalPoints: 40,
      }),
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(personal.status).toBe(400);
    expect(await personal.json()).toEqual({ error: '管理员代客接受报价不能使用客户积分，请由客户在结算时自行选择积分抵扣' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM "Order"').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM PointsLog').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 40 });
    expect(db.prepare('SELECT status FROM Quote').get()).toEqual({ status: 'sent' });
  });

  it('rejects admin group points and numeric strings without spending customer points', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'buyer_points', email: 'buyer-points@test.com', points: 40 });
    db.prepare('UPDATE Inquiry SET userId = ? WHERE id = ?').run('buyer_points', 'i1');
    await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'A', price: 150, quantity: 2 }] }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    const quoteRow = db.prepare('SELECT id FROM Quote WHERE inquiryId = ?').get('i1') as { id: string };
    const group = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemIndices: [0], quantities: { 0: 2 }, quoteId: quoteRow.id, quoteVersion: 1,
        acceptanceAttemptId: 'accept-group-admin', paymentMethod: 'alipay', groupPoints: '10', groupId: 'g1',
      }),
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(group.status).toBe(400);
    expect(await group.json()).toEqual({ error: '管理员代客接受报价不能使用客户积分，请由客户在结算时自行选择积分抵扣' });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 40 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM "Order"').get()).toEqual({ count: 0 });
  });

  it('still lets an admin accept a quote when points are omitted or zero', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'buyer_points', email: 'buyer-points@test.com', points: 40 });
    db.prepare('UPDATE Inquiry SET userId = ? WHERE id = ?').run('buyer_points', 'i1');
    await quotePOST(makeReq('i1', { items: [{ productId: 'p1', name: 'A', price: 150, quantity: 2 }] }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    const quoteRow = db.prepare('SELECT id FROM Quote WHERE inquiryId = ?').get('i1') as { id: string };
    const response = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemIndices: [0], quantities: { 0: 2 }, quoteId: quoteRow.id, quoteVersion: 1,
        acceptanceAttemptId: 'accept-zero-points', paymentMethod: 'alipay', personalPoints: 0, groupPoints: 0,
      }),
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(response.status).toBe(200);
    const order = db.prepare('SELECT total, pointsPersonal, pointsGroup, pointsDiscount, pointsApplied, customerId FROM "Order"').get();
    expect(order).toEqual({
      total: 300,
      pointsPersonal: 0,
      pointsGroup: 0,
      pointsDiscount: 0,
      pointsApplied: 0,
      customerId: 'buyer_points',
    });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 40 });
  });

  it('returns 400 for invalid items JSON string', async () => {
    const res = await quotePOST(makeReq('i1', { items: 'not-json' }) as NextRequest, {
      params: Promise.resolve({ id: 'i1' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent inquiry', async () => {
    const res = await quotePOST(makeReq('nonexistent') as NextRequest, {
      params: Promise.resolve({ id: 'nonexistent' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/inquiries/archive', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedInquiry(db, { id: 'i1', name: 'A', email: 'a@test.com' });
    seedInquiry(db, { id: 'i2', name: 'B', email: 'b@test.com' });
  });

  function makeReq(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/inquiries/archive', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('archives multiple inquiries', async () => {
    const res = await archivePATCH(makeReq({ inquiryIds: ['i1', 'i2'], action: 'archive' }) as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.count).toBe(2);

    const db = getTestDb();
    const all = db.prepare('SELECT id, archivedAt FROM Inquiry ORDER BY id').all() as Array<{ id: string; archivedAt: string | null }>;
    expect(all.every(o => o.archivedAt !== null)).toBe(true);
  });

  it('unarchives inquiries', async () => {
    const db = getTestDb();
    db.prepare('UPDATE Inquiry SET archivedAt = datetime(\'now\') WHERE id = ?').run('i1');

    const res = await archivePATCH(makeReq({ inquiryIds: ['i1'], action: 'unarchive' }) as NextRequest);
    expect(res.status).toBe(200);

    const i1 = db.prepare('SELECT archivedAt FROM Inquiry WHERE id = ?').get('i1') as { archivedAt: string | null };
    expect(i1.archivedAt).toBeNull();
  });

  it('archives instead of deleting, and keeps quotes and linked orders', async () => {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO Quote (id, inquiryId, version, status, subtotal, currency, createdAt, updatedAt)
      VALUES ('q1', 'i1', 1, 'accepted', 100, 'CNY', datetime('now'), datetime('now'))
    `).run();
    db.prepare(`
      INSERT INTO "Order" (id, inquiryId, email, subtotal, total, status, shippingMethod, operationLogs, createdAt, updatedAt)
      VALUES ('o1', 'i1', 'a@test.com', 100, 100, 'confirmed', 'logistics', '[]', datetime('now'), datetime('now'))
    `).run();

    const res = await archivePATCH(makeReq({ inquiryIds: ['i1'], action: 'delete' }) as NextRequest);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true, count: 1 });

    const inquiry = db.prepare('SELECT id, archivedAt FROM Inquiry WHERE id = ?').get('i1') as { id: string; archivedAt: string | null };
    expect(inquiry.id).toBe('i1');
    expect(inquiry.archivedAt).not.toBeNull();
    expect(db.prepare('SELECT id FROM InquiryItem WHERE inquiryId = ?').all('i1')).toHaveLength(1);
    expect(db.prepare('SELECT id, inquiryId, status FROM Quote WHERE id = ?').get('q1')).toEqual({
      id: 'q1',
      inquiryId: 'i1',
      status: 'accepted',
    });
    expect(db.prepare('SELECT id, inquiryId FROM "Order" WHERE id = ?').get('o1')).toEqual({
      id: 'o1',
      inquiryId: 'i1',
    });
    const sibling = db.prepare('SELECT archivedAt FROM Inquiry WHERE id = ?').get('i2') as { archivedAt: string | null };
    expect(sibling.archivedAt).toBeNull();

    const list = await inquiriesGET(new NextRequest('http://localhost:3000/api/inquiries') as NextRequest);
    const active = await list.json() as Array<{ id: string }>;
    expect(active.map((inquiry) => inquiry.id)).toEqual(['i2']);
  });

  it('returns 400 for empty inquiryIds', async () => {
    const res = await archivePATCH(makeReq({ inquiryIds: [], action: 'archive' }) as NextRequest);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid action', async () => {
    const res = await archivePATCH(makeReq({ inquiryIds: ['i1'], action: 'purge' }) as NextRequest);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/inquiries/archived', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedInquiry(db, { id: 'i1', name: 'A', email: 'a@test.com' });
    seedInquiry(db, { id: 'i2', name: 'B', email: 'b@test.com', archivedAt: new Date().toISOString() });
  });

  it('returns only archived inquiries', async () => {
    const res = await archivedGET(new NextRequest('http://localhost:3000/api/admin/inquiries/archived') as NextRequest);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.inquiries).toHaveLength(1);
    expect(json.inquiries[0].id).toBe('i2');
  });
});
