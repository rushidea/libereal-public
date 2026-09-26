import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession } from '@/lib/session';
import { CREDIT_REVIEW_POLICY, creditRestrictionForOverdueDays, overdueDaysFromDueAt } from '@/lib/customer-credit';
import {
  hasOrganizationPermission,
  organizationRbacErrorStatus,
  OrganizationRbacError,
  requireOrganizationPermission,
} from '@/lib/organization-service';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const { id } = await params;

  try {
    const membership = await requireOrganizationPermission(user.id, id, 'organization.records.read');
    const [orders, inquiries] = await Promise.all([
      prisma.order.findMany({
        where: { organizationId: id, ownerScope: 'organization' },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          customerId: true,
          status: true,
          subtotal: true,
          adjustmentTotal: true,
          total: true,
          paymentMethod: true,
          pointsPersonal: true,
          pointsGroup: true,
          pointsGroupId: true,
          pointsDiscount: true,
          pointsRefundedPersonal: true,
          pointsRefundedGroup: true,
          createdAt: true,
          archivedAt: true,
          researchGroup: { select: { id: true, name: true } },
          receivable: {
            select: { id: true, amount: true, status: true, dueAt: true, paidAt: true },
          },
        },
      }),
      prisma.inquiry.findMany({
        where: { organizationId: id, ownerScope: 'organization' },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          status: true,
          subtotal: true,
          createdAt: true,
          archivedAt: true,
        },
      }),
    ]);

    const canReviewOrders = hasOrganizationPermission(membership, 'organization.orders.review');
    const now = new Date();
    const payables = orders.flatMap((order) => {
        const receivable = order.receivable;
        if (!receivable) return [];
        const overdueDays = overdueDaysFromDueAt(receivable.dueAt, now);
        return {
          orderId: order.id,
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
    const openPayables = payables.filter((payable) => ['open', 'overdue'].includes(payable.status));
    const maxOverdueDays = openPayables.reduce((max, payable) => Math.max(max, payable.overdueDays), -1);
    return NextResponse.json({
      organization: { id, name: membership.organization.name },
      canReviewOrders,
      payableSummary: {
        totalOutstanding: openPayables.reduce((sum, payable) => sum + payable.amount, 0),
        maxOverdueDays,
        restriction: creditRestrictionForOverdueDays(maxOverdueDays),
        policy: CREDIT_REVIEW_POLICY,
        checkedAt: now,
      },
      orders: orders.map((order) => ({
        ...order,
        canReview: canReviewOrders && order.status === 'pending' && order.customerId !== user.id,
      })),
      inquiries,
      payables,
    });
  } catch (error) {
    if (error instanceof OrganizationRbacError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: organizationRbacErrorStatus(error) },
      );
    }
    console.error('[organizations.history] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '组织历史记录读取失败' }, { status: 500 });
  }
}
