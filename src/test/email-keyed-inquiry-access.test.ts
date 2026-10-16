import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
}));
vi.mock('@/lib/organization-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/organization-service')>();
  return {
    ...actual,
    listOrganizationIdsForPermission: vi.fn(async () => []),
  };
});
vi.mock('@/lib/organization-record-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/organization-record-access')>();
  return {
    ...actual,
    getReadableOrganizationIds: vi.fn(async () => []),
  };
});

import { auth } from '@/lib/auth';
import { GET as inquiryGET } from '@/app/api/inquiries/[id]/route';
import { POST as quotePOST } from '@/app/api/inquiries/[id]/quote/route';
import { GET as myOrdersGET } from '@/app/api/my-orders/route';
import { GET as ordersGET } from '@/app/api/orders/route';
import { POST as confirmPOST } from '@/app/api/orders/[id]/confirm-items/route';
import { GET as notificationsGET } from '@/app/api/notifications/route';
import { prisma } from '@/lib/prisma';

const authMock = vi.mocked(auth);
const attackerId = 'attacker-1';
const victimEmail = 'victim@example.com';

function asUser(user: { id: string; email: string; role?: string }) {
  authMock.mockResolvedValue({
    user: {
      id: user.id,
      email: user.email,
      name: 'User',
      role: user.role ?? 'customer',
      sessionId: `session-${user.id}`,
    },
  } as never);
}

function seedGuestInquiry() {
  const db = getTestDb();
  db.prepare(`
    INSERT INTO Inquiry (id, name, email, phone, institution, status, userId, createdAt, operationLogs)
    VALUES ('inq-guest', '访客', ?, '13800000000', '清华大学', 'pending_quote', NULL, datetime('now'), '[]')
  `).run(victimEmail);
  db.prepare(`
    INSERT INTO InquiryItem (id, inquiryId, position, productId, name, unitPrice, quantity, lineTotal, createdAt, updatedAt)
    VALUES ('inq-guest-item', 'inq-guest', 0, 'p1', '试剂', 100, 1, 100, datetime('now'), datetime('now'))
  `).run();
}

function seedAttacker(emailVerified: string | null) {
  getTestDb().prepare(`
    INSERT INTO User (id, name, email, role, emailVerified, createdAt, updatedAt)
    VALUES (?, '占用者', ?, 'customer', ?, datetime('now'), datetime('now'))
  `).run(attackerId, victimEmail, emailVerified);
}

async function sendQuote() {
  asUser({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin' });
  const response = await quotePOST(new NextRequest('http://localhost/api/inquiries/inq-guest/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }), { params: Promise.resolve({ id: 'inq-guest' }) });
  expect(response.status).toBe(200);
  return getTestDb().prepare('SELECT id FROM Quote WHERE inquiryId = ?').get('inq-guest') as { id: string };
}

function confirmRequest(quoteId: string, attemptId: string) {
  return new NextRequest('http://localhost/api/orders/inq-guest/confirm-items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      itemIndices: [0],
      quantities: { 0: 1 },
      quoteId,
      quoteVersion: 1,
      acceptanceAttemptId: attemptId,
      acceptedLegalIds: ['site-sales-terms', 'customer-purchase'],
    }),
  });
}

describe('email-keyed inquiry access', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedGuestInquiry();
    seedAttacker(null);
  });

  it('blocks an unverified email from reading, listing, or confirming another person inquiry', async () => {
    const quote = await sendQuote();
    asUser({ id: attackerId, email: victimEmail });

    const detail = await inquiryGET(new NextRequest('http://localhost/api/inquiries/inq-guest'), {
      params: Promise.resolve({ id: 'inq-guest' }),
    });
    expect(detail.status).toBe(403);

    const mine = await myOrdersGET();
    const mineBody = await mine.json() as { inquiries: Array<{ id: string }> };
    expect(mineBody.inquiries.map((item) => item.id)).not.toContain('inq-guest');

    const confirm = await confirmPOST(confirmRequest(quote.id, 'attempt-unverified'), {
      params: Promise.resolve({ id: 'inq-guest' }),
    });
    expect(confirm.status).toBe(403);
    expect(getTestDb().prepare('SELECT id FROM "Order"').get()).toBeUndefined();
  });

  it('allows the same mailbox after it is verified, including case differences', async () => {
    getTestDb().prepare('UPDATE User SET emailVerified = ? WHERE id = ?').run(new Date().toISOString(), attackerId);
    const quote = await sendQuote();
    asUser({ id: attackerId, email: victimEmail });

    const mine = await myOrdersGET();
    const mineBody = await mine.json() as { inquiries: Array<{ id: string }> };
    expect(mineBody.inquiries.map((item) => item.id)).toContain('inq-guest');

    getTestDb().prepare('UPDATE Inquiry SET email = ? WHERE id = ?').run('Victim@Example.com', 'inq-guest');
    const detail = await inquiryGET(new NextRequest('http://localhost/api/inquiries/inq-guest'), {
      params: Promise.resolve({ id: 'inq-guest' }),
    });
    expect(detail.status).toBe(200);

    const confirm = await confirmPOST(confirmRequest(quote.id, 'attempt-verified'), {
      params: Promise.resolve({ id: 'inq-guest' }),
    });
    expect(confirm.status).toBe(200);
  });

  it('still lets the creator open their own inquiry before the mailbox is verified', async () => {
    getTestDb().prepare('UPDATE Inquiry SET userId = ?, email = ? WHERE id = ?').run(attackerId, 'other@example.com', 'inq-guest');
    const quote = await sendQuote();
    asUser({ id: attackerId, email: victimEmail });

    const detail = await inquiryGET(new NextRequest('http://localhost/api/inquiries/inq-guest'), {
      params: Promise.resolve({ id: 'inq-guest' }),
    });
    expect(detail.status).toBe(200);

    const confirm = await confirmPOST(confirmRequest(quote.id, 'attempt-owner'), {
      params: Promise.resolve({ id: 'inq-guest' }),
    });
    expect(confirm.status).toBe(200);
  });

  it('does not expose another person order or notification through an unverified email', async () => {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO "Order" (id, email, customerId, subtotal, total, status, owner_scope, createdAt, updatedAt)
      VALUES
        ('ord-guest', ?, NULL, 10, 10, 'pending', 'personal', datetime('now'), datetime('now')),
        ('ord-own', ?, ?, 10, 10, 'pending', 'personal', datetime('now'), datetime('now'))
    `).run(victimEmail, 'wechat_abc@wechat.local', attackerId);
    await prisma.notification.create({
      data: {
        email: victimEmail,
        role: 'customer',
        type: 'quote_received',
        title: '报价',
        content: '已报价',
        scope: 'personal',
      },
    });
    asUser({ id: attackerId, email: victimEmail });

    const orders = await ordersGET(new NextRequest('http://localhost/api/orders'));
    const orderBody = await orders.json() as Array<{ id: string }>;
    expect(orderBody.map((item) => item.id)).toEqual(['ord-own']);

    const notifications = await notificationsGET(new NextRequest('http://localhost/api/notifications'));
    const notificationBody = await notifications.json() as { notifications: Array<{ title: string }> };
    expect(notificationBody.notifications.map((item) => item.title)).not.toContain('报价');

    db.prepare('UPDATE User SET emailVerified = ? WHERE id = ?').run(new Date().toISOString(), attackerId);
    const verifiedOrders = await ordersGET(new NextRequest('http://localhost/api/orders'));
    const verifiedBody = await verifiedOrders.json() as Array<{ id: string }>;
    expect(verifiedBody.map((item) => item.id).sort()).toEqual(['ord-guest', 'ord-own']);
  });
});
