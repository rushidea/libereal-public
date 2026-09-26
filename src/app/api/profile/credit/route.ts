import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import {
  CREDIT_REVIEW_POLICY,
  creditLimitForAccount,
  creditRestrictionForOverdueDays,
  ensureCreditAccount,
  overdueDaysFromDueAt,
} from '@/lib/customer-credit';
import { getReadableOrganizationIds } from '@/lib/organization-record-access';

export async function GET() {
  const sessionUser = await requireUser();
  if (sessionUser instanceof NextResponse) return sessionUser;
  const user = await prisma.user.findUnique({ where: { id: sessionUser.id }, select: { id: true, tier: true } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const account = await prisma.$transaction((tx) => ensureCreditAccount(tx, user.id, user.tier));
  const readableOrganizationIds = await getReadableOrganizationIds(user.id);
  const rawReceivables = await prisma.accountReceivable.findMany({
    where: {
      userId: user.id,
      status: { in: ['open', 'overdue'] },
      order: {
        OR: [
          { ownerScope: 'personal' },
          ...(readableOrganizationIds.length ? [{ ownerScope: 'organization', organizationId: { in: readableOrganizationIds } }] : []),
        ],
      },
    },
    orderBy: { dueAt: 'asc' },
    select: { id: true, orderId: true, amount: true, status: true, dueAt: true, reminderCount: true, termStartedAt: true },
  });
  const now = new Date();
  const receivables = rawReceivables.map((receivable) => {
    const overdueDays = overdueDaysFromDueAt(receivable.dueAt, now);
    return {
      ...receivable,
      overdueDays,
      trigger: overdueDays >= CREDIT_REVIEW_POLICY.holdAfterDays
        ? 'order_hold'
        : overdueDays >= CREDIT_REVIEW_POLICY.limitedAfterDays
          ? 'credit_limited'
          : overdueDays >= CREDIT_REVIEW_POLICY.reminderAfterDays
            ? 'reminder'
            : 'normal',
    };
  });
  const maxOverdueDays = receivables.reduce((max, receivable) => Math.max(max, receivable.overdueDays), -1);
  const limit = creditLimitForAccount(account);
  return NextResponse.json({
    tier: user.tier,
    policy: CREDIT_REVIEW_POLICY,
    account: {
      status: account.status,
      restriction: account.status === 'paused' ? 'paused' : creditRestrictionForOverdueDays(maxOverdueDays),
      maxOverdueDays,
      limit,
      usedAmount: account.usedAmount,
      availableAmount: Math.max(0, limit - account.usedAmount),
      paymentTermDays: account.paymentTermDays,
      checkedAt: now,
    },
    receivables,
  });
}
