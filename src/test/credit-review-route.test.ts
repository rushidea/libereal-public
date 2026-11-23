import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/cron/credit-review/route';
import { executeBackgroundTask } from '@/lib/background-task-handlers';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

const outbound = vi.hoisted(() => ({ mail: vi.fn(), sms: vi.fn() }));
vi.mock('@/lib/mail', () => ({ sendMail: outbound.mail, sendQuoteNotificationEmailNow: vi.fn() }));
vi.mock('@/lib/aliyun-sms', () => ({ sendAliyunSmsTemplate: outbound.sms }));

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

async function reviewCredit() {
  return POST(new NextRequest('http://localhost/api/cron/credit-review', {
    method: 'POST', headers: { 'x-cron-secret': CRON_SECRET },
  }));
}

async function makePayable(orderId: string, userId: string, amount: number, due: number) {
  seedOrder(orderId, userId);
  return prisma.accountReceivable.create({ data: { orderId, userId, amount, confirmedAt: daysAgo(due + 30), dueAt: daysAgo(due) } });
}

async function creditPosting(orderId: string, receivableId: string | null, label: string, amountCents: number) {
  const allocation = await prisma.purchaseActivity.create({ data: {
    id: label, orderId, amountCents, action: 'record_customer_receipt', actorId: 'synthetic-finance',
    detail: '{}', createdAt: new Date().toISOString(),
  } });
  return prisma.customerCashPosting.create({ data: { orderId, receivableId, bankAllocationId: allocation.id, amountCents } });
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
    outbound.mail.mockReset().mockResolvedValue({ ok: true, provider: 'test' });
    outbound.sms.mockReset();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

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

    const response = await reviewCredit();
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

  it('reminds only on the outstanding balance and keeps the existing reminder interval across calendar buckets', async () => {
    const now = new Date('2026-11-23T09:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const settled = await makePayable('office-fully-received', 'user_hold', 500, 95);
    const partial = await makePayable('office-partly-received', 'user_hold', 750, 31);
    await prisma.creditAccount.create({ data: { userId: 'user_hold', baseLimit: 5000, status: 'active' } });
    await creditPosting(settled.orderId, settled.id, 'settled-office-bank', 100000);
    await creditPosting(partial.orderId, null, 'partial-office-bank', 40000);

    expect(await (await reviewCredit()).json()).toMatchObject({ receivables: 1, reminded: 1, suspended: 0 });
    expect(await prisma.accountReceivable.findUnique({ where: { id: settled.id } })).toMatchObject({ status: 'open', reminderCount: 0 });
    expect(await prisma.notification.findFirstOrThrow({ where: { type: 'account_payable_reminder' } }))
      .toMatchObject({ content: expect.stringContaining('¥600.00') });
    const first = await prisma.backgroundTask.findFirstOrThrow({ where: { type: 'order.reminder' } });
    vi.setSystemTime(now.getTime() + 14 * 86400000);
    expect(await (await reviewCredit()).json()).toMatchObject({ reminded: 0 });
    vi.setSystemTime(now.getTime() + 15 * 86400000);
    expect(await (await reviewCredit()).json()).toMatchObject({ reminded: 1 });
    expect(await (await reviewCredit()).json()).toMatchObject({ reminded: 0 });
    expect(await prisma.notification.count({ where: { type: 'account_payable_reminder' } })).toBe(2);
    expect(await prisma.backgroundTask.count({ where: { type: 'order.reminder' } })).toBe(2);
    expect(await executeBackgroundTask(first)).toMatchObject({ skipped: 'receivable_reminder_no_longer_due' });
    expect(outbound.mail).not.toHaveBeenCalled();
  });

  it('rechecks the current receipt and due date before sending a queued reminder', async () => {
    const settled = await makePayable('office-paid-after-queue', 'user_hold', 1000, 32);
    const rescheduled = await makePayable('office-term-amended', 'user_hold', 1000, 33);
    const partial = await makePayable('office-paid-in-part-after-queue', 'user_hold', 1000, 34);
    expect(await (await reviewCredit()).json()).toMatchObject({ reminded: 3 });
    await creditPosting(settled.orderId, settled.id, 'settled-after-queue', 100000);
    await prisma.accountReceivable.update({ where: { id: rescheduled.id }, data: { dueAt: daysAgo(-15) } });
    await creditPosting(partial.orderId, partial.id, 'part-paid-after-queue', 80000);
    const tasks = await prisma.backgroundTask.findMany({ where: { type: 'order.reminder' } });
    const taskFor = (id: string) => tasks.find(task => JSON.parse(task.payload).receivableId === id)!;
    expect(await executeBackgroundTask(taskFor(settled.id))).toHaveProperty('skipped');
    expect(await executeBackgroundTask(taskFor(rescheduled.id))).toHaveProperty('skipped');
    expect(outbound.mail).not.toHaveBeenCalled();
    await expect(executeBackgroundTask(taskFor(partial.id))).resolves.toMatchObject({ email: true, recipients: 1 });
    expect(outbound.mail).toHaveBeenCalledTimes(1);
    expect(outbound.mail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'hold@test.com', text: expect.stringContaining('¥200.00'),
    }));
  });

  it('uses the transaction-time balance even if the earlier scan saw a due order', async () => {
    const payable = await makePayable('office-pays-after-scan', 'user_hold', 1000, 95);
    await prisma.creditAccount.create({ data: { userId: 'user_hold', baseLimit: 5000, status: 'active' } });
    const scanned = await prisma.accountReceivable.findMany({ where: { id: payable.id } });
    await creditPosting(payable.orderId, payable.id, 'settled-before-reminder-write', 100000);
    const earlierScan = vi.spyOn(prisma.accountReceivable, 'findMany').mockResolvedValueOnce(scanned);
    try {
      expect(await (await reviewCredit()).json()).toMatchObject({ receivables: 0, reminded: 0, suspended: 0 });
      expect(earlierScan).toHaveBeenCalled();
      expect(await prisma.accountReceivable.findUnique({ where: { id: payable.id } })).toMatchObject({ status: 'open', reminderCount: 0 });
      expect(await prisma.backgroundTask.count({ where: { type: 'order.reminder' } })).toBe(0);
      expect(await prisma.notification.count({ where: { type: 'account_payable_reminder' } })).toBe(0);
    } finally {
      earlierScan.mockRestore();
    }
  });
});
