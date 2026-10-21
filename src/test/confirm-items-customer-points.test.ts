import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';
import { prisma } from '@/lib/prisma';
import { refundOrderPointsProportionally } from '@/lib/points-checkout-service';

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({
  auth: (...args: unknown[]) => authMock(...args),
}));

import { POST as quotePOST } from '@/app/api/inquiries/[id]/quote/route';
import { POST as confirmQuotePOST } from '@/app/api/orders/[id]/confirm-items/route';

function asUser(user: { id: string; email: string; role: 'admin' | 'customer' }) {
  authMock.mockResolvedValue({
    user: {
      id: user.id,
      email: user.email,
      name: user.role === 'admin' ? 'Admin' : '询价人',
      role: user.role,
      sessionId: `session-${user.id}`,
    },
  });
}

function seedInquiry(db: ReturnType<typeof getTestDb>) {
  db.prepare(`
    INSERT INTO Inquiry (id, name, email, phone, institution, status, createdAt, operationLogs)
    VALUES ('i1', '询价人', 'q@test.com', '13800000000', '清华大学', 'pending_quote', datetime('now'), '[]')
  `).run();
  db.prepare(`
    INSERT INTO InquiryItem (id, inquiryId, position, productId, name, unitPrice, quantity, lineTotal, createdAt, updatedAt)
    VALUES ('i1_item_0', 'i1', 0, 'p1', 'A', 100, 1, 100, datetime('now'), datetime('now'))
  `).run();
  db.prepare('UPDATE Inquiry SET userId = ? WHERE id = ?').run('buyer_points', 'i1');
}

describe('POST /api/orders/[id]/confirm-items customer points', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'buyer_points', email: 'q@test.com', name: '询价人', points: 40, role: 'customer' });
    seedInquiry(db);
    asUser({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin' });
  });

  async function quotedId() {
    const response = await quotePOST(new NextRequest('http://localhost:3000/api/inquiries/i1/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: [{ productId: 'p1', name: 'A', price: 150, quantity: 2 }] }),
    }), { params: Promise.resolve({ id: 'i1' }) });
    expect(response.status).toBe(200);
    return (getTestDb().prepare('SELECT id FROM Quote WHERE inquiryId = ?').get('i1') as { id: string }).id;
  }

  it('still lets the customer deduct their own points when accepting a quote', async () => {
    const quoteId = await quotedId();
    asUser({ id: 'buyer_points', email: 'q@test.com', role: 'customer' });

    const response = await confirmQuotePOST(new NextRequest('http://localhost:3000/api/orders/i1/confirm-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemIndices: [0],
        quantities: { 0: 2 },
        quoteId,
        quoteVersion: 1,
        acceptanceAttemptId: 'customer-accept-points',
        acceptedLegalIds: ['site-sales-terms', 'customer-purchase'],
        paymentMethod: 'alipay',
        personalPoints: 40,
      }),
    }), { params: Promise.resolve({ id: 'i1' }) });

    expect(response.status).toBe(200);
    const db = getTestDb();
    const order = db.prepare('SELECT id, total, pointsPersonal, pointsDiscount, pointsApplied, customerId, status FROM "Order"').get() as {
      id: string;
      total: number;
      pointsPersonal: number;
      pointsDiscount: number;
      pointsApplied: number;
      customerId: string;
      status: string;
    };
    expect(order).toMatchObject({
      total: 260,
      pointsPersonal: 40,
      pointsDiscount: 40,
      pointsApplied: 1,
      customerId: 'buyer_points',
      status: 'unpaid',
    });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM PointsLog WHERE userId = ? AND type = ?').get('buyer_points', 'order_redeem')).toEqual({ count: 1 });

    const refunded = await prisma.$transaction((tx) => refundOrderPointsProportionally(tx, {
      orderId: order.id,
      refundYuan: 300,
      originalPaidYuan: 300,
      actorUserId: 'buyer_points',
      reason: '订单取消退回积分',
    }));
    expect(refunded).toEqual({ ok: true, personal: 40, group: 0 });
    expect(db.prepare('SELECT points FROM User WHERE id = ?').get('buyer_points')).toEqual({ points: 40 });
  });
});
