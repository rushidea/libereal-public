import { describe, it, expect, beforeAll, beforeEach, afterAll, vi, type Mock } from 'vitest';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
}));

import { POST as inquiryPOST } from '@/app/api/inquiry/route';
import { auth } from '@/lib/auth';
import { NextRequest } from 'next/server';
import { getTestDb, closeTestDb, seedUser, clearAllTables } from './db-helpers';

const authMock = auth as unknown as Mock;

function seedInquiry(userId: string, id: string) {
  const db = getTestDb();
  db.prepare(`
    INSERT INTO Inquiry (id, userId, name, email, phone, institution, subtotal, status, createdAt, operationLogs)
    VALUES (?, ?, 'Existing', 'existing@test.com', '13800000000', 'Existing Lab', 0, '待人工审核', datetime('now'), '[]')
  `).run(id, userId);
}

function seedProduct() {
  const db = getTestDb();
  db.prepare(`
    INSERT INTO Product (id, catalogNumber, name, brand, price, applications, reactivity, inStock, promotion, hazardous, createdAt, updatedAt)
    VALUES ('prod_1', 'CAT-1', 'Server Priced Product', 'CST', 123, '[]', '[]', 1, 0, 0, datetime('now'), datetime('now'))
  `).run();
}

function makeReq(body: object, ip: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/inquiry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Buyer',
    email: 'buyer@test.com',
    phone: '13900000000',
    institution: 'Test Lab',
    items: [
      {
        productId: 'CAT-1',
        catalogNumber: 'CAT-1',
        name: 'Server Priced Product',
        price: 0.01,
        quantity: 2,
      },
    ],
    ...overrides,
  };
}

describe('POST /api/inquiry', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS _rate_limits (
        ip TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ip, window_start)
      )
    `);
    db.exec('DELETE FROM _rate_limits');
    seedProduct();
  });

  it('binds the inquiry to the authenticated user, ignoring client-submitted userId', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'real_user', email: 'real@test.com', role: 'customer' });
    db.prepare("UPDATE User SET discountRate = 0.995 WHERE id = 'real_user'").run();
    seedUser(db, { id: 'spoofed_user', email: 'spoofed@test.com', role: 'customer' });
    seedInquiry('spoofed_user', 'existing_1');
    seedInquiry('spoofed_user', 'existing_2');
    seedInquiry('spoofed_user', 'existing_3');

    authMock.mockResolvedValue({
      user: { id: 'real_user', email: 'real@test.com', name: 'Real User', role: 'customer', sessionId: 'session-1' },
      expires: new Date(Date.now() + 86400000).toISOString(),
    });

    const res = await inquiryPOST(makeReq(validBody({ userId: 'spoofed_user' }), '10.0.0.1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('待人工审核');

    const row = db.prepare('SELECT id, userId, status, subtotal FROM Inquiry WHERE email = ? ORDER BY createdAt DESC LIMIT 1')
      .get('buyer@test.com') as { id: string; userId: string; status: string; subtotal: number };
    expect(row.userId).toBe('real_user');
    expect(row.status).toBe('待人工审核');
    expect(row.subtotal).toBe(244.78);

    const item = db.prepare('SELECT unitPrice, quantity, lineTotal, pricingSource FROM InquiryItem WHERE inquiryId = ?')
      .get(row.id) as { unitPrice: number; quantity: number; lineTotal: number; pricingSource: string };
    expect(item).toMatchObject({
      unitPrice: 122.39,
      quantity: 2,
      lineTotal: 244.78,
      pricingSource: 'db',
    });
  });

  it('enforces the new-user limit against the authenticated user', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'real_user', email: 'real@test.com', role: 'customer' });
    seedUser(db, { id: 'spoofed_user', email: 'spoofed@test.com', role: 'customer' });
    seedInquiry('real_user', 'existing_1');
    seedInquiry('real_user', 'existing_2');
    seedInquiry('real_user', 'existing_3');

    authMock.mockResolvedValue({
      user: { id: 'real_user', email: 'real@test.com', name: 'Real User', role: 'customer', sessionId: 'session-1' },
      expires: new Date(Date.now() + 86400000).toISOString(),
    });

    const res = await inquiryPOST(makeReq(validBody({ userId: 'spoofed_user' }), '10.0.0.2'));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/新用户额度已用完/);
  });
});
