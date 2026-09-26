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
import { getTestDb, closeTestDb, seedAdmin, clearAllTables } from './db-helpers';

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
    productId?: string; name: string; price: number; quantity: number;
  }>;
  const insertItem = db.prepare(`
    INSERT INTO InquiryItem (id, inquiryId, position, productId, name, unitPrice, quantity, lineTotal, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
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
    const orderItem = db.prepare('SELECT unitPrice, quantity FROM OrderItem').get() as { unitPrice: number; quantity: number };
    expect(orderItem).toEqual({ unitPrice: 150, quantity: 2 });
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

  it('deletes inquiries', async () => {
    const res = await archivePATCH(makeReq({ inquiryIds: ['i1'], action: 'delete' }) as NextRequest);
    expect(res.status).toBe(200);

    const db = getTestDb();
    const remaining = db.prepare('SELECT id FROM Inquiry').all() as Array<{ id: string }>;
    expect(remaining.map(i => i.id)).toEqual(['i2']);
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
