import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { calculateOrderPoints } from '@/lib/points';
import { getTierByRollingSpend, DEFAULT_TIER, TIERS } from '@/lib/discount';

type Tx = Prisma.TransactionClient;

export const CREDIT_REVIEW_POLICY = {
  reminderAfterDays: 30,
  limitedAfterDays: 60,
  limitedCreditLimit: 5_000,
  holdAfterDays: 90,
  reminderIntervalDays: 15,
} as const;

export type CreditRestriction = 'active' | 'credit_limited' | 'overdue_hold';

export function overdueDaysFromDueAt(dueAt: Date | null, now = new Date()): number {
  if (!dueAt) return -1;
  return Math.floor((now.getTime() - dueAt.getTime()) / 86400000);
}

export function creditRestrictionForOverdueDays(maxOverdueDays: number): CreditRestriction {
  if (maxOverdueDays >= CREDIT_REVIEW_POLICY.holdAfterDays) return 'overdue_hold';
  if (maxOverdueDays >= CREDIT_REVIEW_POLICY.limitedAfterDays) return 'credit_limited';
  return 'active';
}

export function creditLimitForAccount(
  account: { baseLimit: number; overrideLimit: number | null; temporaryLimit: number; temporaryUntil: Date | null; status?: string },
  now = new Date(),
): number {
  const limit = effectiveCreditLimit(account, now);
  return account.status === 'credit_limited'
    ? Math.min(limit, CREDIT_REVIEW_POLICY.limitedCreditLimit)
    : limit;
}

export function effectiveCreditLimit(account: {
  baseLimit: number;
  overrideLimit: number | null;
  temporaryLimit: number;
  temporaryUntil: Date | null;
}, now = new Date()) {
  const permanent = account.overrideLimit ?? account.baseLimit;
  const temporary = account.temporaryUntil && account.temporaryUntil >= now ? account.temporaryLimit : 0;
  return permanent + temporary;
}

export async function ensureCreditAccount(tx: Tx, userId: string, tierName: string) {
  const tier = TIERS.find((item) => item.name === tierName) ?? DEFAULT_TIER;
  return tx.creditAccount.upsert({
    where: { userId },
    update: {},
    create: { userId, baseLimit: tier.creditLimit },
  });
}

export async function reserveOrderCredit(tx: Tx, orderId: string, actorId?: string | null) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, email: true, customerId: true, total: true, status: true } });
  if (!order) throw new Error('ORDER_NOT_FOUND');
  const existing = await tx.accountReceivable.findUnique({ where: { orderId } });
  if (existing) return existing;
  const user = order.customerId
    ? await tx.user.findUnique({ where: { id: order.customerId }, select: { id: true, tier: true } })
    : await tx.user.findUnique({ where: { email: order.email }, select: { id: true, tier: true } });
  if (!user) throw new Error('CREDIT_USER_NOT_FOUND');
  const account = await ensureCreditAccount(tx, user.id, user.tier);
  if (!['active', 'credit_limited'].includes(account.status)) throw new Error('CREDIT_ACCOUNT_SUSPENDED');
  const limit = creditLimitForAccount(account);
  if (account.usedAmount + order.total > limit) throw new Error('CREDIT_LIMIT_EXCEEDED');
  const confirmedAt = new Date();
  const usedAmount = account.usedAmount + order.total;
  await tx.creditAccount.update({ where: { id: account.id }, data: { usedAmount } });
  await tx.creditTransaction.create({ data: { userId: user.id, orderId, type: 'reserve', amount: order.total, balanceAfter: usedAmount, actorId } });
  await tx.order.update({ where: { id: orderId }, data: { customerId: user.id } });
  return tx.accountReceivable.create({
    data: {
      orderId,
      userId: user.id,
      amount: order.total,
      confirmedAt,
      paymentTermDaysSnapshot: account.paymentTermDays,
    },
  });
}

export async function startOrderReceivableTerm(tx: Tx, orderId: string, startedAt = new Date()) {
  const receivable = await tx.accountReceivable.findUnique({ where: { orderId } });
  if (!receivable) throw new Error('RECEIVABLE_NOT_FOUND');
  if (receivable.status === 'paid' || receivable.status === 'cancelled' || receivable.termStartedAt) return receivable;
  const dueAt = new Date(startedAt.getTime() + receivable.paymentTermDaysSnapshot * 86400000);
  return tx.accountReceivable.update({
    where: { id: receivable.id },
    data: { termStartedAt: startedAt, dueAt },
  });
}

export async function releaseOrderReceivableOnCancellation(tx: Tx, orderId: string, actorId?: string | null) {
  const receivable = await tx.accountReceivable.findUnique({ where: { orderId } });
  if (!receivable || receivable.status === 'cancelled') return receivable;
  if (receivable.status === 'paid') throw new Error('PAID_ORDER_REFUND_REQUIRED');
  const account = await tx.creditAccount.findUnique({ where: { userId: receivable.userId } });
  if (!account) throw new Error('CREDIT_ACCOUNT_NOT_FOUND');
  const usedAmount = Math.max(0, account.usedAmount - receivable.amount);
  await tx.creditAccount.update({ where: { id: account.id }, data: { usedAmount } });
  await tx.creditTransaction.create({
    data: {
      userId: receivable.userId,
      orderId,
      type: 'release',
      amount: -receivable.amount,
      balanceAfter: usedAmount,
      reason: '订单取消释放授信',
      actorId,
    },
  });
  return tx.accountReceivable.update({ where: { id: receivable.id }, data: { status: 'cancelled' } });
}

export async function settleOrderReceivable(tx: Tx, orderId: string, actorId?: string | null) {
  const receivable = await tx.accountReceivable.findUnique({ where: { orderId } });
  if (!receivable) throw new Error('RECEIVABLE_NOT_FOUND');
  if (receivable.status === 'paid') return receivable;
  const account = await tx.creditAccount.findUnique({ where: { userId: receivable.userId } });
  if (!account) throw new Error('CREDIT_ACCOUNT_NOT_FOUND');
  const paidAt = new Date();
  const usedAmount = Math.max(0, account.usedAmount - receivable.amount);
  await tx.creditAccount.update({
    where: { id: account.id },
    data: { usedAmount, status: ['overdue_hold', 'credit_limited'].includes(account.status) ? 'active' : account.status },
  });
  await tx.creditTransaction.create({ data: { userId: receivable.userId, orderId, type: 'release', amount: -receivable.amount, balanceAfter: usedAmount, actorId } });
  await tx.accountReceivable.update({ where: { id: receivable.id }, data: { status: 'paid', paidAt } });
  await tx.order.update({ where: { id: orderId }, data: { status: 'completed', paidAt } });
  const existingPoints = await tx.pointsLog.findFirst({ where: { userId: receivable.userId, relatedId: orderId, type: 'order_credit' } });
  const earned = calculateOrderPoints(receivable.amount);
  if (!existingPoints && earned > 0) {
    await tx.user.update({ where: { id: receivable.userId }, data: { points: { increment: earned } } });
    await tx.pointsLog.create({ data: { userId: receivable.userId, delta: earned, type: 'order_credit', relatedId: orderId, reason: '订单回款积分' } });
  }
  await recalculateUserTier(tx, receivable.userId, paidAt);
  return tx.accountReceivable.findUniqueOrThrow({ where: { id: receivable.id } });
}

export async function recalculateUserTier(tx: Tx, userId: string, now = new Date()) {
  const from = new Date(now);
  from.setMonth(from.getMonth() - 24);
  const orders = await tx.order.findMany({ where: { customerId: userId, paidAt: { gte: from, lte: now }, status: 'completed' }, select: { total: true } });
  const rollingSpend = orders.reduce((sum, order) => sum + order.total, 0);
  const tier = getTierByRollingSpend(rollingSpend);
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { tier: true } });
  const account = await ensureCreditAccount(tx, userId, user.tier);
  if (user.tier !== tier.name) {
    await tx.user.update({ where: { id: userId }, data: { tier: tier.name } });
    await tx.userTierHistory.create({ data: { userId, fromTier: user.tier, toTier: tier.name, rollingSpend, calculationFrom: from, calculationTo: now, reason: 'daily_rolling_spend' } });
  }
  if (account.overrideLimit == null && account.baseLimit !== tier.creditLimit) {
    await tx.creditAccount.update({ where: { id: account.id }, data: { baseLimit: tier.creditLimit } });
  }
  return { tier: tier.name, rollingSpend };
}

export async function runDailyTierReview(now = new Date()) {
  const users = await prisma.user.findMany({ where: { role: 'customer' }, select: { id: true } });
  for (const user of users) await prisma.$transaction((tx) => recalculateUserTier(tx, user.id, now));
  return users.length;
}
