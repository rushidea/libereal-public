import { NextRequest, NextResponse } from 'next/server';
import { requirePhysicalStatus } from '@/lib/fulfillment-legacy';
import { prepareOrderPurchases } from '@/lib/purchase-orders';
import { prisma } from '@/lib/prisma';
import { assertOrderPricingResolved, closeOrderRepricing, jsonObject, pendingOrderRepricing } from '@/lib/order-catalog-repricing';
import type { Prisma } from '@prisma/client';
import { orderItemView } from '@/lib/commerce-records';
import { getAlipayPaymentSummary } from '@/data/alipay-payment';
import {
  evaluatePostDeliveryCredit,
  releaseOrderReceivableOnCancellation,
  reserveOrderCredit,
} from '@/lib/customer-credit';
import type { OrderCreditReviewSummary } from '@/lib/credit-summary';
import { assertOrderTransition, isAutoCloseableOrderStatus, isInactiveOrderStatus, requiresPaidAlipayRefund } from '@/lib/order-domain';
import { restoreRedeemedOrderCoupons } from '@/lib/coupon-service';
import { releaseOrderInventory, reserveOrderInventory } from '@/lib/inventory';
import { orderStatusRequiresFinanceWrite, receivableOccupiesCredit } from '@/lib/order-finance-access';
import { alipayCancellationPending, recordOrderChangeDuringAlipayReview } from '@/lib/order-payment-review';
import { alipayReceiptWhere } from '@/lib/payment-concurrency';
import { requireAdmin } from '@/lib/session';
import { getLatestAlipayAttempt, merchantOrderApprovalPreview, ORDER_APPROVAL_INCLUDE, orderApprovalConflict, verifyMerchantOrderAcceptance } from '@/lib/order-approval';
import { authorizeAdminOrderMutation, consumeAdminOrderStepUp, extractStepUpToken } from '@/lib/admin-order-step-up';
import { writeAuditLog } from '@/lib/audit';
import { isPostDeliveryPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { refundOrderPointsProportionally, requirePointsRefund, POINTS_REFUND_FAILED } from '@/lib/points-checkout-service';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('orders.read');
  if (admin instanceof NextResponse) return admin;

  try {
    const { id } = await params;
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        ...ORDER_APPROVAL_INCLUDE,
        statusHistory: { orderBy: { createdAt: 'asc' } },
        shipments: { orderBy: { createdAt: 'desc' }, include: { items: true } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    const { orderItems, paymentAttempts, ...rest } = order;
    const pendingPricing = order.inquiryId && isAutoCloseableOrderStatus(order.status)
      ? await pendingOrderRepricing(prisma, order.id) : null;
    const creditEval = order.status === 'pending' && isPostDeliveryPaymentMethod(order.paymentMethod)
      ? await evaluatePostDeliveryCredit(prisma, {
        userId: order.customerId, email: order.email, paymentMethod: order.paymentMethod, total: order.total,
      })
      : undefined;
    let creditReview: OrderCreditReviewSummary | null = null;
    if (creditEval?.applicable) {
      const flaggedAtSubmission = order.events.some((event) => event.type === 'credit_review_required');
      creditReview = {
        userId: creditEval.userId,
        tier: creditEval.tier,
        orderTotal: order.total,
        paymentMethod: order.paymentMethod ?? null,
        flaggedAtSubmission,
        needsReview: creditEval.suspended || creditEval.exceedsLimit,
        suspended: creditEval.suspended,
        exceedsLimit: creditEval.exceedsLimit,
        shortfall: creditEval.shortfall,
        summary: creditEval.summary,
      };
    }
    const acceptanceHistory = order.statusHistory.find(({ fromStatus, toStatus, actorId, metadata }) => {
      const details = jsonObject(metadata);
      return fromStatus === 'pending' && toStatus === 'confirmed' && Boolean(actorId)
        && details.action === 'accept_order' && details.actorType === 'libereal_admin';
    });
    return NextResponse.json({
      order: {
        ...rest,
        inquiry: undefined,
        receivable: undefined,
        items: orderItems.map(orderItemView),
        payment: getAlipayPaymentSummary(rest, getLatestAlipayAttempt(paymentAttempts)),
        approvalPreview: await merchantOrderApprovalPreview(prisma, order, creditEval),
        acceptedAt: acceptanceHistory?.createdAt ?? null,
        pendingCatalogRepricing: pendingPricing && typeof pendingPricing.quoteId === 'string' && typeof pendingPricing.proposalHash === 'string'
          ? { inquiryId: order.inquiryId, quoteId: pendingPricing.quoteId, orderId: order.id, proposalHash: pendingPricing.proposalHash } : null,
        creditReview,
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[admin/orders/[id] GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const reader = await requireAdmin('orders.read');
  if (reader instanceof NextResponse) return reader;

  let accepting = false;
  try {
    const { id } = await params;
    const body = await req.json();
    const { status, reason } = body;
    accepting = status === 'confirmed';
    const stepUpToken = extractStepUpToken(body);

    const existing = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        paymentMethod: true,
        paidAt: true,
        total: true,
        pointsDiscount: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const hasOpenReceivable = typeof status === 'string'
      && isPostDeliveryPaymentMethod(existing.paymentMethod)
      && (status === 'cancelled' || status === 'closed')
      && status !== existing.status
      ? receivableOccupiesCredit((await prisma.accountReceivable.findUnique({ where: { orderId: id }, select: { status: true } }))?.status)
      : false;
    const admin = await authorizeAdminOrderMutation(orderStatusRequiresFinanceWrite({
      currentStatus: existing.status,
      nextStatus: status,
      paymentMethod: existing.paymentMethod,
      hasOpenReceivable,
    }) ? 'finance.write' : 'orders.write', stepUpToken);
    if (admin instanceof NextResponse) return admin;

    const updateData: Prisma.OrderUpdateInput = {};
    const normalizedPaymentMethod = normalizeOrderPaymentMethod(existing.paymentMethod);
    if (status === 'confirmed' && normalizedPaymentMethod === 'alipay' && !existing.paidAt) {
      return NextResponse.json({ error: 'ALIPAY_PAYMENT_REQUIRED' }, { status: 409 });
    }
    if (
      status === 'confirmed'
      && normalizedPaymentMethod !== 'alipay'
      && !isPostDeliveryPaymentMethod(existing.paymentMethod)
    ) {
      return NextResponse.json({ error: 'PAYMENT_METHOD_REQUIRED' }, { status: 409 });
    }
    if (requiresPaidAlipayRefund(status, existing.paymentMethod, existing.paidAt)) {
      return NextResponse.json({ error: 'PAID_ORDER_REFUND_REQUIRED' }, { status: 409 });
    }
    if (status) {
      assertOrderTransition(existing.status, status);
      updateData.status = status;
      if (!isAutoCloseableOrderStatus(status)) updateData.autoCloseAt = null;
    }

    const stepUpFailure = await consumeAdminOrderStepUp(admin, stepUpToken);
    if (stepUpFailure) return stepUpFailure;

    const updated = await prisma.$transaction(async (tx) => {
      if ((status === 'cancelled' || status === 'closed')
        && await recordOrderChangeDuringAlipayReview(tx, id, admin, status, reason)) return null;
      await requirePhysicalStatus(tx, id, existing.status, status);
      if (accepting) await assertOrderPricingResolved(tx, id);
      const acceptance = accepting ? await verifyMerchantOrderAcceptance(tx, id, body.approvalVersion) : null;
      if ((status === 'cancelled' || status === 'closed') && status !== existing.status) {
        const inactive = await tx.order.updateMany({
          where: { id, status: existing.status, ...(status === 'cancelled' || normalizedPaymentMethod === 'alipay' ? { paidAt: null } : {}),
            NOT: { paymentAttempts: { some: alipayReceiptWhere } } },
          data: { status, autoCloseAt: null },
        });
        if (inactive.count !== 1) throw new Error('ORDER_CANCELLATION_CONFLICT');
      }
      const result = await tx.order.update({ where: { id, ...(acceptance ? { status: 'pending', archivedAt: null } : {}) }, data: {
        ...updateData,
        ...(status && status !== existing.status ? {
          statusHistory: {
            create: {
              fromStatus: existing.status,
              toStatus: status,
              actorId: admin.id,
              actorEmail: admin.email,
              reason: reason || 'admin_status_update',
              ...(acceptance ? { metadata: acceptance.metadata } : {}),
            },
          },
          events: {
            create: {
              type: 'status_changed',
              actorId: admin.id,
              actorEmail: admin.email,
              message: `${existing.status} -> ${status}`,
              metadata: JSON.stringify({ fromStatus: existing.status, toStatus: status, reason: reason || null }),
            },
          },
        } : {}),
      } });
      if (acceptance) {
        if (isPostDeliveryPaymentMethod(acceptance.order.paymentMethod)) await reserveOrderCredit(tx, id, admin.id);
        await reserveOrderInventory(tx, id, admin.id);
        await prepareOrderPurchases(tx, id, admin);
      }
      if (isInactiveOrderStatus(status) && !isInactiveOrderStatus(existing.status)) {
        await closeOrderRepricing(tx, id, { id: admin.id, email: admin.email });
        if (isPostDeliveryPaymentMethod(existing.paymentMethod)) await releaseOrderReceivableOnCancellation(tx, id, admin.id);
        await releaseOrderInventory(tx, id, admin.id);
        await restoreRedeemedOrderCoupons(tx, id);
        const originalPaidYuan = Math.round((existing.total + existing.pointsDiscount) * 100) / 100;
        requirePointsRefund(await refundOrderPointsProportionally(tx, {
          orderId: id,
          refundYuan: originalPaidYuan,
          originalPaidYuan,
          actorUserId: admin.id,
          reason: status === 'closed' ? '管理员关闭订单退回积分' : '管理员取消订单退回积分',
        }));
      }
      if (status && status !== existing.status) await writeAuditLog({ actorId: admin.id, actorEmail: admin.email, action: 'order.status_changed', resource: 'orders', targetType: 'Order', targetId: id, before: { status: existing.status }, after: { status }, reason }, tx);
      return result;
    }, { isolationLevel: 'Serializable' });
    if (!updated) return NextResponse.json(alipayCancellationPending, { status: 409 });
    return NextResponse.json({ order: updated });
  } catch (err) {
    console.error('[admin/orders/[id] PATCH] error:', err);
    const message = err instanceof Error ? err.message : '';
    const approvalConflict = accepting && orderApprovalConflict(err);
    if (approvalConflict) return NextResponse.json(approvalConflict, { status: 409 });
    if ((err as { code?: string })?.code === 'P2025') return NextResponse.json({ error: '订单已变化，请重新查看。' }, { status: 409 });
    if (message === 'FULFILLMENT_RECORDS_REQUIRED') return NextResponse.json({ error: '请先按发货明细登记实际运送和签收情况。' }, { status: 409 });
    if (message === 'CREDIT_RESERVATION_REVIEW_REQUIRED' || message === 'CREDIT_ACCOUNT_NOT_FOUND') {
      return NextResponse.json({ error: '请先核对原订单的授信预占流水。', code: message }, { status: 409 });
    }
    if (message === POINTS_REFUND_FAILED) {
      return NextResponse.json({ error: POINTS_REFUND_FAILED }, { status: 409 });
    }
    if (['QUOTE_REPRICE_REQUIRED', 'CREDIT_LIMIT_EXCEEDED', 'CREDIT_ACCOUNT_SUSPENDED', 'CREDIT_USER_NOT_FOUND', 'RECEIVABLE_NOT_FOUND', 'INVALID_ORDER_TRANSITION', 'INSUFFICIENT_AVAILABLE_INVENTORY', 'ALIPAY_PAYMENT_REQUIRED', 'PAID_ORDER_REFUND_REQUIRED', 'ORDER_CANCELLATION_CONFLICT'].includes(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message === 'INVALID_ORDER_STATUS') return NextResponse.json({ error: message }, { status: 400 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
