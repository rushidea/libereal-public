import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  CREDIT_REVIEW_POLICY,
  creditRestrictionForOverdueDays,
  overdueDaysFromDueAt,
  runDailyTierReview,
} from '@/lib/customer-credit';
import { getEphemeralStore } from '@/lib/ephemeral-store';
import { enqueueBackgroundTask } from '@/lib/background-tasks';

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const store = getEphemeralStore();
  const lockKey = 'task-lock:credit-review';
  const lockToken = await store.acquireLock(lockKey, 15 * 60 * 1000);
  if (!lockToken) return NextResponse.json({ error: 'Task already running' }, { status: 409 });
  try {
    const now = new Date();
    const reminderInterval = CREDIT_REVIEW_POLICY.reminderIntervalDays * 86400000;
    const receivables = await prisma.accountReceivable.findMany({
      where: { status: { in: ['open', 'overdue'] }, dueAt: { not: null, lte: now } },
      include: {
        user: { select: { id: true, email: true, phone: true } },
        order: {
          select: {
            id: true,
            organizationId: true,
            ownerScope: true,
            organization: { select: { ownerUserId: true, owner: { select: { email: true } } } },
          },
        },
      },
    });
    let reminded = 0;
    let suspended = 0;
    let limited = 0;
    const receivablesByUser = new Map<string, typeof receivables>();
    for (const receivable of receivables) {
      const userReceivables = receivablesByUser.get(receivable.userId) || [];
      userReceivables.push(receivable);
      receivablesByUser.set(receivable.userId, userReceivables);
    }
    const restrictedAccounts = await prisma.creditAccount.findMany({
      where: { status: { in: ['credit_limited', 'overdue_hold'] } },
      select: { userId: true },
    });
    for (const account of restrictedAccounts) {
      if (!receivablesByUser.has(account.userId)) receivablesByUser.set(account.userId, []);
    }

    for (const [userId, userReceivables] of receivablesByUser) {
      const account = await prisma.creditAccount.findUnique({ where: { userId } });
      if (!account) continue;
      const maxOverdueDays = userReceivables.length
        ? Math.max(...userReceivables.map((receivable) => overdueDaysFromDueAt(receivable.dueAt, now)))
        : -1;
      const hasEligibleHold = userReceivables.some((receivable) => {
        const overdueDays = overdueDaysFromDueAt(receivable.dueAt, now);
        return overdueDays >= CREDIT_REVIEW_POLICY.holdAfterDays
          && (!account.manuallyUnlockedAt || !receivable.dueAt || account.manuallyUnlockedAt < receivable.dueAt);
      });
      const desiredStatus = account.status === 'paused'
        ? 'paused'
        : hasEligibleHold
          ? 'overdue_hold'
          : creditRestrictionForOverdueDays(maxOverdueDays);
      if (desiredStatus !== account.status) {
        await prisma.$transaction(async (tx) => {
          await tx.creditAccount.update({ where: { id: account.id }, data: { status: desiredStatus } });
          const isLimited = desiredStatus === 'credit_limited';
          await tx.notification.create({
            data: {
              userId,
              email: userReceivables[0]?.user.email || '',
              role: 'customer',
              type: isLimited ? 'credit_limit_reduced' : desiredStatus === 'overdue_hold' ? 'credit_order_hold' : 'credit_order_released',
              title: isLimited ? '账户进入限额下单' : desiredStatus === 'overdue_hold' ? '账户已限制下单' : '账户下单状态恢复',
              content: isLimited
                ? `账户存在超过 ${CREDIT_REVIEW_POLICY.limitedAfterDays} 天未结清订单，累计应付款额度已调整为 ¥${CREDIT_REVIEW_POLICY.limitedCreditLimit.toFixed(2)}。`
                : desiredStatus === 'overdue_hold'
                  ? `账户存在超过 ${CREDIT_REVIEW_POLICY.holdAfterDays} 天未结清订单，系统已限制新订单。`
                  : '账户未结清订单已回到系统允许的下单状态。',
              linkUrl: '/account/credit',
              metadata: JSON.stringify({ userId, status: desiredStatus, maxOverdueDays }),
            },
          });
        });
        if (desiredStatus === 'credit_limited') limited++;
        if (desiredStatus === 'overdue_hold') suspended++;
      }
    }

    for (const receivable of receivables) {
      if (!receivable.dueAt) continue;
      const overdueDays = overdueDaysFromDueAt(receivable.dueAt, now);
      if (overdueDays < CREDIT_REVIEW_POLICY.reminderAfterDays) continue;
      if (receivable.lastReminderAt && now.getTime() - receivable.lastReminderAt.getTime() < reminderInterval) continue;
      await prisma.$transaction(async (tx) => {
        await enqueueBackgroundTask('order.reminder', { receivableId: receivable.id, overdueDays }, {
          priority: 8,
          maxAttempts: 5,
          dedupeKey: `receivable-reminder:${receivable.id}:${Math.floor(now.getTime() / reminderInterval)}`,
        }, tx);
        await tx.accountReceivable.update({ where: { id: receivable.id }, data: { lastReminderAt: now, reminderCount: { increment: 1 }, status: 'overdue' } });
        const organization = receivable.order.ownerScope === 'organization' ? receivable.order.organization : null;
        const recipients = [{
          userId: receivable.user.id,
          email: receivable.user.email,
          linkUrl: organization ? `/account/organizations/history?organizationId=${encodeURIComponent(receivable.order.organizationId || '')}&view=payables` : '/account/credit',
        }];
        if (organization && organization.ownerUserId !== receivable.user.id && organization.owner.email) {
          recipients.push({ userId: organization.ownerUserId, email: organization.owner.email, linkUrl: `/account/organizations/history?organizationId=${encodeURIComponent(receivable.order.organizationId || '')}&view=payables` });
        }
        await Promise.all(recipients.map((recipient) => tx.notification.create({
          data: {
            userId: recipient.userId,
            email: recipient.email,
            role: 'customer',
            type: 'account_payable_reminder',
            title: '应付款提醒',
            content: `订单 ${receivable.order.id} 应付款 ¥${receivable.amount.toFixed(2)} 已超过 ${overdueDays} 天，请及时完成付款。`,
            linkUrl: recipient.linkUrl,
            metadata: JSON.stringify({ receivableId: receivable.id, orderId: receivable.order.id, overdueDays }),
          },
        })));
      });
      reminded++;
    }
    const reviewedUsers = await runDailyTierReview(now);
    return NextResponse.json({ reviewedUsers, receivables: receivables.length, reminded, limited, suspended });
  } finally {
    await store.releaseLock(lockKey, lockToken).catch((error) => console.error('[credit review lock release]', error));
  }
}
