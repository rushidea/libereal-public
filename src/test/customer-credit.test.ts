import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  CREDIT_REVIEW_POLICY,
  creditLimitForAccount,
  creditRestrictionForOverdueDays,
  effectiveCreditLimit,
  overdueDaysFromDueAt,
  releaseOrderReceivableOnCancellation,
  reserveOrderCredit,
  settleOrderReceivable,
  startOrderReceivableTerm,
} from '@/lib/customer-credit';
import { getTierByRollingSpend } from '@/lib/discount';
const tierFixture = vi.hoisted(() => [{ level: 1, min: 0, name: 'Sample tier', creditLimit: 5000, discountRate: 0.9 }, { level: 2, min: 1000, name: 'Sample plus', creditLimit: 8000, discountRate: 0.85 }]);
vi.mock('@/lib/discount', () => ({ getTierByRollingSpend: (amount: number, tiers = tierFixture) => [...tiers].sort((a, b) => b.min - a.min).find((tier) => amount >= tier.min) ?? tierFixture[0], DEFAULT_TIER: tierFixture[0], TIERS: tierFixture, TIER_DISCOUNT_RATES: {} }));
import { calculateOrderPoints } from '@/lib/points';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

function seedOrder(id: string, email: string, subtotal: number, customerId = 'user_1') {
  getTestDb().prepare(`
    INSERT INTO "Order" (id, email, customerId, subtotal, total, status, shippingMethod, operationLogs, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, 'pending', 'logistics', '[]', datetime('now'), datetime('now'))
  `).run(id, email, customerId, subtotal, subtotal);
}

describe('membership and customer credit', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedUser(db, { id: 'user_1', email: 'buyer@test.com', tier: 'Sample tier' });
  });

  it('uses supplied tier policy configuration', () => {
    expect(getTierByRollingSpend(0, tierFixture).name).toBe('Sample tier');
    expect(getTierByRollingSpend(1000, tierFixture).name).toBe('Sample plus');
  });

  it('adds temporary credit only before its expiry', () => {
    const base = { baseLimit: 5000, overrideLimit: null, temporaryLimit: 2000 };
    expect(effectiveCreditLimit({ ...base, temporaryUntil: new Date(Date.now() + 1000) })).toBe(7000);
    expect(effectiveCreditLimit({ ...base, temporaryUntil: new Date(Date.now() - 1000) })).toBe(5000);
  });

  it('applies the system-wide 30/60/90 day restriction thresholds', () => {
    const dueAt = new Date('2026-07-01T00:00:00.000Z');
    const now = new Date('2026-08-30T00:00:00.000Z');
    expect(overdueDaysFromDueAt(dueAt, now)).toBe(60);
    expect(creditRestrictionForOverdueDays(CREDIT_REVIEW_POLICY.reminderAfterDays)).toBe('active');
    expect(creditRestrictionForOverdueDays(CREDIT_REVIEW_POLICY.limitedAfterDays)).toBe('credit_limited');
    expect(creditRestrictionForOverdueDays(CREDIT_REVIEW_POLICY.holdAfterDays)).toBe('overdue_hold');
    expect(creditLimitForAccount({ baseLimit: 20000, overrideLimit: null, temporaryLimit: 0, temporaryUntil: null, status: 'credit_limited' })).toBe(5000);
  });

  it('reserves credit on confirmation, starts the term on delivery and releases it on payment', async () => {
    seedOrder('order_1', 'buyer@test.com', 4000);
    await prisma.$transaction((tx) => reserveOrderCredit(tx, 'order_1', 'admin_1'));
    const reserved = await prisma.creditAccount.findUniqueOrThrow({ where: { userId: 'user_1' } });
    expect(reserved.usedAmount).toBe(4000);
    expect(await prisma.accountReceivable.findUnique({ where: { orderId: 'order_1' } })).toMatchObject({
      status: 'open',
      amount: 4000,
      termStartedAt: null,
      dueAt: null,
      paymentTermDaysSnapshot: 30,
    });

    const startedAt = new Date('2026-07-17T00:00:00.000Z');
    await prisma.$transaction((tx) => startOrderReceivableTerm(tx, 'order_1', startedAt));
    expect(await prisma.accountReceivable.findUnique({ where: { orderId: 'order_1' } })).toMatchObject({
      termStartedAt: startedAt,
      dueAt: new Date('2026-08-16T00:00:00.000Z'),
    });

    await prisma.$transaction((tx) => settleOrderReceivable(tx, 'order_1', 'finance_1'));
    const settled = await prisma.creditAccount.findUniqueOrThrow({ where: { userId: 'user_1' } });
    expect(settled.usedAmount).toBe(0);
    expect(await prisma.accountReceivable.findUnique({ where: { orderId: 'order_1' } })).toMatchObject({ status: 'paid' });
    expect(await prisma.user.findUnique({ where: { id: 'user_1' }, select: { points: true } })).toEqual({ points: 4 });
  });

  it('releases occupied credit when an unshipped post-delivery order is cancelled', async () => {
    seedOrder('order_1', 'buyer@test.com', 4000);
    await prisma.$transaction((tx) => reserveOrderCredit(tx, 'order_1', 'admin_1'));
    await prisma.$transaction((tx) => releaseOrderReceivableOnCancellation(tx, 'order_1', 'admin_1'));
    expect(await prisma.creditAccount.findUniqueOrThrow({ where: { userId: 'user_1' } })).toMatchObject({ usedAmount: 0 });
    expect(await prisma.accountReceivable.findUnique({ where: { orderId: 'order_1' } })).toMatchObject({ status: 'cancelled' });
  });

  it('rejects orders above the available credit limit', async () => {
    seedOrder('order_1', 'buyer@test.com', 6000);
    await expect(prisma.$transaction((tx) => reserveOrderCredit(tx, 'order_1'))).rejects.toThrow('CREDIT_LIMIT_EXCEEDED');
    expect(await prisma.accountReceivable.count()).toBe(0);
  });

  it('enforces the system limit for an account in the 60-day restricted state', async () => {
    await prisma.creditAccount.create({ data: { userId: 'user_1', baseLimit: 20000, status: 'credit_limited', usedAmount: 4500 } });
    seedOrder('order_1', 'buyer@test.com', 600);
    await expect(prisma.$transaction((tx) => reserveOrderCredit(tx, 'order_1'))).rejects.toThrow('CREDIT_LIMIT_EXCEEDED');
    expect(await prisma.accountReceivable.count()).toBe(0);
  });

  it('credits one point per completed thousand yuan', () => {
    expect(calculateOrderPoints(999)).toBe(0);
    expect(calculateOrderPoints(1000)).toBe(1);
    expect(calculateOrderPoints(9999)).toBe(9);
  });
});
