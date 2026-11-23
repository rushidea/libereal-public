import { receivableOrderBalance, receivableOutstandingCents } from '@/lib/receivable-balance';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  CREDIT_REVIEW_POLICY,
  creditReminderIntervalMs,
  creditStatusForOverdueReceivables,
  hasEligibleCreditHold,
  maxOverdueDaysForReceivables,
  overdueReceivableWhere,
  overdueDaysFromDueAt,
  receivableReminderKey,
  runDailyTierReview,
} from '@/lib/customer-credit';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { cronUnauthorizedResponse, isCronRequestAuthorized } from '@/lib/cron-auth';
import { getEphemeralStore } from '@/lib/ephemeral-store';

export const dynamic = 'force-dynamic';

// 与 /api/cron/auto-close、/api/cron/indexnow 相同：只认 x-cron-secret。
// 仓库内没有本任务的 crontab。服务器上若仍按旧实现发送 Authorization: Bearer，需要改成：
//   curl -fsS -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/credit-review
async function handle(req: NextRequest) {
  if (!isCronRequestAuthorized(req)) return cronUnauthorizedResponse();
  const store = getEphemeralStore();
  const lockKey = 'task-lock:credit-review';
  const lockToken = await store.acquireLock(lockKey, 15 * 60 * 1000);
  if (!lockToken) return NextResponse.json({ error: 'Task already running' }, { status: 409 });
  try {
    const now = new Date();
    const due = overdueReceivableWhere(now);
    const [candidates, restrictedAccounts] = await Promise.all([
      prisma.accountReceivable.findMany({ where: due, select: { userId: true } }),
      prisma.creditAccount.findMany({ where: { status: { in: ['credit_limited', 'overdue_hold'] } }, select: { userId: true } }),
    ]);
    let reminded = 0;
    let suspended = 0;
    let limited = 0;
    let receivables = 0;
    const userIds = new Set([...candidates, ...restrictedAccounts].map(row => row.userId));

    for (const userId of userIds) {
      const result = await prisma.$transaction(async tx => {
        const [account, rows] = await Promise.all([
          tx.creditAccount.findUnique({ where: { userId }, include: { user: { select: { email: true } } } }),
          tx.accountReceivable.findMany({ where: { ...due, userId }, include: {
            user: { select: { email: true } },
            order: { select: { ...receivableOrderBalance, id: true, organizationId: true, ownerScope: true,
              organization: { select: { ownerUserId: true, owner: { select: { email: true } } } } } },
          } }),
        ]);
        const outstanding = rows.map(row => ({ ...row,
          balance: receivableOutstandingCents(row.amount, row.status, row.order.cashPostings, row.order.total),
        })).filter(row => row.balance > 0);
        const maxOverdueDays = maxOverdueDaysForReceivables(outstanding, now);
        let newRestriction: string | null = null;
        if (account) {
          const status = creditStatusForOverdueReceivables({
            currentStatus: account.status, statusSource: account.statusSource, maxOverdueDays,
            hasEligibleHold: hasEligibleCreditHold(outstanding, account.manuallyUnlockedAt, now),
          });
          if (status !== account.status) {
            await tx.creditAccount.update({ where: { id: account.id }, data: { status, statusSource: 'system' } });
            newRestriction = status;
            const isLimited = status === 'credit_limited';
            const isHeld = status === 'overdue_hold';
            await tx.notification.create({
              data: {
                userId, email: account.user.email, role: 'customer',
                type: isLimited ? 'credit_limit_reduced' : isHeld ? 'credit_order_hold' : 'credit_order_released',
                title: isLimited ? '账户进入限额下单' : isHeld ? '账户已限制下单' : '账户下单状态恢复',
                content: isLimited
                  ? `账户存在超过 ${CREDIT_REVIEW_POLICY.limitedAfterDays} 天未结清订单，累计应付款额度已调整为 ¥${CREDIT_REVIEW_POLICY.limitedCreditLimit.toFixed(2)}。`
                  : isHeld ? `账户存在超过 ${CREDIT_REVIEW_POLICY.holdAfterDays} 天未结清订单，系统已限制新订单。`
                    : '账户未结清订单已回到系统允许的下单状态。',
                linkUrl: '/account/credit',
                metadata: JSON.stringify({ userId, status, maxOverdueDays }),
              },
            });
          }
        }
        let reminders = 0;
        for (const receivable of outstanding) {
          if (!receivable.dueAt) continue;
          const overdueDays = overdueDaysFromDueAt(receivable.dueAt, now);
          if (overdueDays < CREDIT_REVIEW_POLICY.reminderAfterDays) continue;
          if (receivable.lastReminderAt && now.getTime() - receivable.lastReminderAt.getTime() < creditReminderIntervalMs) continue;
          const dedupeKey = receivableReminderKey(receivable.id, now);
          if (await tx.backgroundTask.findUnique({ where: { dedupeKey }, select: { id: true } })) continue;
          const changed = await tx.accountReceivable.updateMany({
            where: { id: receivable.id, status: receivable.status, dueAt: receivable.dueAt, lastReminderAt: receivable.lastReminderAt },
            data: { lastReminderAt: now, reminderCount: { increment: 1 }, status: 'overdue' },
          });
          if (changed.count !== 1) continue;
          await enqueueBackgroundTask('order.reminder', {
            receivableId: receivable.id, overdueDays, reminderAt: now.toISOString(), dueAt: receivable.dueAt.toISOString(),
          }, { priority: 8, maxAttempts: 5, dedupeKey }, tx);
          const { order } = receivable;
          const organization = order.ownerScope === 'organization' ? order.organization : null;
          const linkUrl = organization
            ? `/account/organizations/history?organizationId=${encodeURIComponent(order.organizationId || '')}&view=payables` : '/account/credit';
          const recipients = [{ userId, email: receivable.user.email }];
          if (organization && organization.ownerUserId !== userId && organization.owner.email) {
            recipients.push({ userId: organization.ownerUserId, email: organization.owner.email });
          }
          const content = `订单 ${order.id} 应付款 ¥${(receivable.balance / 100).toFixed(2)} 已超过 ${overdueDays} 天，请及时完成付款。`;
          const metadata = JSON.stringify({ receivableId: receivable.id, orderId: order.id, overdueDays });
          await tx.notification.createMany({ data: recipients.map(recipient => ({
            ...recipient, role: 'customer', type: 'account_payable_reminder', title: '应付款提醒', content, linkUrl, metadata,
          })) });
          reminders++;
        }
        return { receivables: outstanding.length, reminders, newRestriction };
      });
      receivables += result.receivables;
      reminded += result.reminders;
      if (result.newRestriction === 'credit_limited') limited++;
      if (result.newRestriction === 'overdue_hold') suspended++;
    }
    const reviewedUsers = await runDailyTierReview(now);
    return NextResponse.json({ reviewedUsers, receivables, reminded, limited, suspended });
  } finally {
    await store.releaseLock(lockKey, lockToken).catch((error) => console.error('[credit review lock release]', error));
  }
}

export const GET = handle;
export const POST = handle;
