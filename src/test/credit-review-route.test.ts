import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/cron/credit-review/route';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

const CRON_SECRET = 'test-cron-secret';

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86400000);
}

function seedOrder(id: string, customerId: string) {
  getTestDb().prepare(`
    INSERT INTO "Order" (id, email, customerId, subtotal, total, status, paymentMethod, shippingMethod, operationLogs, createdAt, updatedAt)
    VALUES (?, 'buyer@test.com', ?, 1000, 1000, 'confirmed', 'bank_transfer', 'logistics', '[]', datetime('now'), datetime('now'))
  `).run(id, customerId);
}

describe('POST /api/cron/credit-review', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeAll(() => { getTestDb(); });
  afterAll(() => {
    process.env.CRON_SECRET = originalSecret;
    closeTestDb();
  });
  beforeEach(() => {
    clearAllTables(getTestDb());
    process.env.CRON_SECRET = CRON_SECRET;
    seedUser(getTestDb(), { id: 'user_manual', email: 'manual@test.com', tier: '璞玉' });
    seedUser(getTestDb(), { id: 'user_clear', email: 'clear@test.com', tier: '璞玉' });
    seedUser(getTestDb(), { id: 'user_hold', email: 'hold@test.com', tier: '璞玉' });
    seedUser(getTestDb(), { id: 'user_manual_hold', email: 'manual-hold@test.com', tier: '璞玉' });
  });

  it('preserves manual limits and stop-orders, and only rewrites statuses the review owns', async () => {
    await prisma.creditAccount.create({
      data: { userId: 'user_manual', baseLimit: 5000, overrideLimit: 12000, status: 'credit_limited', statusSource: 'manual' },
    });
    await prisma.creditAccount.create({
      data: { userId: 'user_clear', baseLimit: 5000, status: 'credit_limited', statusSource: 'system' },
    });
    await prisma.creditAccount.create({
      data: { userId: 'user_hold', baseLimit: 5000, status: 'active', statusSource: 'system' },
    });
    await prisma.creditAccount.create({
      data: { userId: 'user_manual_hold', baseLimit: 5000, overrideLimit: 8000, status: 'overdue_hold', statusSource: 'manual' },
    });
    seedOrder('order_hold', 'user_hold');
    seedOrder('order_manual_hold', 'user_manual_hold');
    await prisma.accountReceivable.create({
      data: {
        orderId: 'order_hold',
        userId: 'user_hold',
        amount: 1000,
        status: 'open',
        confirmedAt: daysAgo(120),
        dueAt: daysAgo(95),
        paymentTermDaysSnapshot: 30,
      },
    });
    await prisma.accountReceivable.create({
      data: {
        orderId: 'order_manual_hold',
        userId: 'user_manual_hold',
        amount: 1000,
        status: 'open',
        confirmedAt: daysAgo(40),
        dueAt: daysAgo(10),
        paymentTermDaysSnapshot: 30,
      },
    });

    const response = await POST(new NextRequest('http://localhost/api/cron/credit-review', {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET },
    }));
    expect(response.status).toBe(200);

    expect(await prisma.creditAccount.findUnique({ where: { userId: 'user_manual' } })).toMatchObject({
      status: 'credit_limited',
      statusSource: 'manual',
      overrideLimit: 12000,
    });
    expect(await prisma.creditAccount.findUnique({ where: { userId: 'user_clear' } })).toMatchObject({
      status: 'active',
      statusSource: 'system',
    });
    expect(await prisma.creditAccount.findUnique({ where: { userId: 'user_hold' } })).toMatchObject({
      status: 'overdue_hold',
      statusSource: 'system',
    });
    expect(await prisma.creditAccount.findUnique({ where: { userId: 'user_manual_hold' } })).toMatchObject({
      status: 'overdue_hold',
      statusSource: 'manual',
      overrideLimit: 8000,
    });
  });
});
