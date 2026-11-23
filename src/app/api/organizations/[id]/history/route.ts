import { receivableCashAmounts, receivableView } from '@/lib/receivable-balance';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession } from '@/lib/session';
import { CREDIT_REVIEW_POLICY, creditRestrictionForOverdueDays, overdueDaysFromDueAt } from '@/lib/customer-credit';
import { QUOTE_EXPIRED_INQUIRY_STATUS } from '@/lib/quote-expiry';
import { settleExpiredQuotes } from '@/lib/quote-expiry-settle';
import {
  isOrganizationOrderCustomer,
  ORGANIZATION_ORDER_REVIEW_INCLUDE,
  organizationOrderCreator,
  organizationReviewState,
} from '@/lib/organization-order-review';
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
        include: {
          ...ORGANIZATION_ORDER_REVIEW_INCLUDE,
          researchGroup: { select: { id: true, name: true } },
          cashPostings: { select: receivableCashAmounts },
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

    const now = new Date();
    const settled = await settleExpiredQuotes(prisma, inquiries.map((inquiry) => inquiry.id), now);
    const expiredInquiryIds = new Set(settled.expiredInquiryIds);
    const visibleInquiries = inquiries.map((inquiry) => (
      expiredInquiryIds.has(inquiry.id) ? { ...inquiry, status: QUOTE_EXPIRED_INQUIRY_STATUS } : inquiry
    ));
    const canReviewOrders = hasOrganizationPermission(membership, 'organization.orders.review');
    const payables = orders.flatMap((order) => {
        const receivable = order.receivable;
        if (!receivable) return [];
        const view = receivableView(receivable, order);
        const overdueDays = view.amount > 0 ? overdueDaysFromDueAt(receivable.dueAt, now) : -1;
        return {
          orderId: order.id,
          ...view,
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
    const openPayables = payables.filter((payable) => payable.amount > 0 && ['open', 'overdue'].includes(payable.status));
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
      orders: orders.map((order) => {
        const creatorId = organizationOrderCreator(order);
        const canCancel = canReviewOrders && !order.archivedAt && order.status === 'pending'
          && !isOrganizationOrderCustomer(order, user);
        return {
          id: order.id, customerId: order.customerId, status: order.status, subtotal: order.subtotal,
          adjustmentTotal: order.adjustmentTotal, total: order.total, paymentMethod: order.paymentMethod,
          pointsPersonal: order.pointsPersonal, pointsGroup: order.pointsGroup, pointsGroupId: order.pointsGroupId,
          pointsDiscount: order.pointsDiscount, pointsRefundedPersonal: order.pointsRefundedPersonal,
          pointsRefundedGroup: order.pointsRefundedGroup, createdAt: order.createdAt, archivedAt: order.archivedAt,
          researchGroup: order.researchGroup, receivable: order.receivable ? receivableView(order.receivable, order) : null,
          organizationReview: organizationReviewState(order, creatorId),
          canCancel, canReview: canCancel && Boolean(creatorId && creatorId !== user.id),
        };
      }),
      inquiries: visibleInquiries,
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
