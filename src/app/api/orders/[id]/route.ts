import { NextRequest, NextResponse } from 'next/server';
import { prepareOrderPurchases } from '@/lib/purchase-orders';
import { prisma } from '@/lib/prisma';
import { assertOrderPricingResolved, closeOrderRepricing } from '@/lib/order-catalog-repricing';
import { requireActiveSession, requireAdmin } from '@/lib/session';
import { authorizeAdminOrderMutation, consumeAdminOrderStepUp, extractStepUpToken } from '@/lib/admin-order-step-up';
import type { Prisma } from '@prisma/client';
import { orderItemView, toOrderItemCreates } from '@/lib/commerce-records';
import { customerShipmentFields, requirePhysicalStatus } from '@/lib/fulfillment-legacy';
import { releaseOrderReceivableOnCancellation, reserveOrderCredit } from '@/lib/customer-credit';
import { orderStatusRequiresFinanceWrite, receivableOccupiesCredit } from '@/lib/order-finance-access';
import { assertOrderTransition, calculateOrderAmounts, isAutoCloseableOrderStatus, isInactiveOrderStatus, ORDER_STATUS_LABELS, requiresPaidAlipayRefund } from '@/lib/order-domain';
import { restoreRedeemedOrderCoupons } from '@/lib/coupon-service';
import { releaseOrderInventory, reserveOrderInventory } from '@/lib/inventory';
import { isPostDeliveryPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { getAlipayPaymentSummary } from '@/data/alipay-payment';
import { refundOrderPointsProportionally, requirePointsRefund, POINTS_REFUND_FAILED } from '@/lib/points-checkout-service';
import { canAccessOrganizationRecord } from '@/lib/organization-record-access';
import { requireOrganizationPermission } from '@/lib/organization-service';
import { emailKeyedAccess } from '@/lib/verified-email-access';
import { writeAuditLog } from '@/lib/audit';
import { commerceLineRefFromRecord, reviewCommerceLinesWithCatalog } from '@/lib/commerce-line-catalog';
import { decideCommerceLineReview, type CommerceLineFinding } from '@/lib/commerce-line-review';
import { ownerPrepaySettlementViews } from '@/lib/order-prepay-settlement';
import { customerOrderStatusMetadata, getLatestAlipayAttempt, merchantOrderApprovalPreview, ORDER_APPROVAL_INCLUDE, orderApprovalConflict, verifyMerchantOrderAcceptance } from '@/lib/order-approval';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  if (user.role === 'admin') {
    const admin = await requireAdmin('orders.read');
    if (admin instanceof NextResponse) return admin;
  }
  const isAdmin = user.role === 'admin';

  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        ...ORDER_APPROVAL_INCLUDE,
        statusHistory: { orderBy: { createdAt: 'asc' } },
        shipments: { orderBy: { createdAt: 'desc' }, select: customerShipmentFields },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (!isAdmin) {
      let allowed = order.ownerScope === 'organization'
        ? Boolean(order.organizationId) && await canAccessOrganizationRecord(user.id, order.organizationId as string)
        : order.customerId === user.id || await emailKeyedAccess(user.id, order.email);
      if (!allowed && order.ownerScope === 'organization' && order.organizationId && order.customerId === user.id) {
        try {
          await requireOrganizationPermission(user.id, order.organizationId, 'organization.orders.create');
          allowed = true;
        } catch {
          allowed = false;
        }
      }
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let inquiry = null;
    if (order.inquiryId) {
      inquiry = await prisma.inquiry.findFirst({
        where: order.ownerScope === 'organization'
          ? { id: order.inquiryId, organizationId: order.organizationId, ownerScope: 'organization' }
          : { id: order.inquiryId },
        select: { id: true, name: true, institution: true, department: true, address: true, phone: true },
      });
    }

    const { orderItems, statusHistory, paymentAttempts, ...rest } = order;
    const settlementViews = await ownerPrepaySettlementViews(prisma, [order]);
    const creditReviewPending = order.status === 'pending'
      && isPostDeliveryPaymentMethod(order.paymentMethod)
      && order.events.some((event) => event.type === 'credit_review_required');
    return NextResponse.json({
      ...rest,
      receivable: undefined,
      items: orderItems.map(orderItemView),
      inquiry,
      statusHistory: isAdmin ? statusHistory : statusHistory.map((entry) => ({
        ...entry, metadata: customerOrderStatusMetadata(entry.metadata),
      })),
      ...(isAdmin ? { approvalPreview: await merchantOrderApprovalPreview(prisma, order) } : {}),
      payment: getAlipayPaymentSummary(order, getLatestAlipayAttempt(paymentAttempts)),
      ownerPrepaySettlement: settlementViews.get(order.id) ?? null,
      creditReviewPending,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[order GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const sessionUser = await requireActiveSession();
  if (sessionUser instanceof NextResponse) return sessionUser;
  let user = sessionUser;
  const isPlatformAdmin = sessionUser.role === 'admin';
  if (isPlatformAdmin) {
    const reader = await requireAdmin('orders.read');
    if (reader instanceof NextResponse) return reader;
  }

  let accepting = false;
  try {
    const body = await req.json();
    accepting = isPlatformAdmin && body.status === 'confirmed';
    const stepUpToken = isPlatformAdmin ? extractStepUpToken(body) : undefined;
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        adjustments: true,
        paymentAttempts: { where: { provider: 'alipay' }, select: { id: true }, take: 1 },
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (isPlatformAdmin) {
      const hasOpenReceivable = typeof body.status === 'string'
        && isPostDeliveryPaymentMethod(order.paymentMethod)
        && (body.status === 'cancelled' || body.status === 'closed')
        && body.status !== order.status
        ? receivableOccupiesCredit((await prisma.accountReceivable.findUnique({ where: { orderId: id }, select: { status: true } }))?.status)
        : false;
      const admin = await authorizeAdminOrderMutation(orderStatusRequiresFinanceWrite({
        currentStatus: order.status,
        nextStatus: body.status,
        paymentMethod: order.paymentMethod,
        hasOpenReceivable,
      }) ? 'finance.write' : 'orders.write', stepUpToken);
      if (admin instanceof NextResponse) return admin;
      user = admin;
      if (body.status === 'confirmed' && order.ownerScope === 'organization' && body.action !== 'accept_order') {
        return NextResponse.json({ error: '请从管理后台确认 Libereal 接单。' }, { status: 409 });
      }
    }

    if (!isPlatformAdmin) {
      if (order.ownerScope === 'organization' && order.organizationId) {
        try {
          await requireOrganizationPermission(user.id, order.organizationId, 'organization.orders.review');
        } catch {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (body.items !== undefined || body.paymentMethod !== undefined || !['confirmed', 'cancelled'].includes(body.status)) {
          return NextResponse.json({ error: '组织成员只能审核订单状态' }, { status: 403 });
        }
        if (order.customerId === user.id) {
          return NextResponse.json({ error: '订单创建者不能审核本人订单' }, { status: 403 });
        }
        if (body.status === 'confirmed') {
          return NextResponse.json({ error: '请在组织采购页面查看订单明细后提交组织审核。', code: 'ORG_ORDER_REVIEW_PREVIEW_REQUIRED' }, { status: 409 });
        }
      } else {
        const ownsPersonalOrder = order.ownerScope === 'personal'
          && (order.customerId === user.id || await emailKeyedAccess(user.id, order.email));
        if (!ownsPersonalOrder || body.status !== 'cancelled' || body.items !== undefined || body.paymentMethod !== undefined) {
          return NextResponse.json({ error: '个人订单仅支持本人取消' }, { status: 403 });
        }
      }
    }

    const updateData: Prisma.OrderUpdateInput = {};
    let effectivePaymentMethod = order.paymentMethod;

    if (body.paymentMethod !== undefined) {
      const normalizedPaymentMethod = normalizeOrderPaymentMethod(body.paymentMethod);
      if (normalizedPaymentMethod === undefined) {
        return NextResponse.json({ error: '付款方式无效' }, { status: 400 });
      }
      const currentPaymentMethod = normalizeOrderPaymentMethod(order.paymentMethod);
      if (currentPaymentMethod !== null && normalizedPaymentMethod === null) {
        return NextResponse.json({ error: 'PAYMENT_METHOD_REQUIRED' }, { status: 400 });
      }
      if (normalizedPaymentMethod !== currentPaymentMethod && (order.paidAt || order.paymentAttempts.length > 0)) {
        return NextResponse.json({ error: 'PAYMENT_METHOD_LOCKED' }, { status: 409 });
      }
      updateData.paymentMethod = normalizedPaymentMethod;
      effectivePaymentMethod = normalizedPaymentMethod;
    }

    let confirmedLineWarnings: CommerceLineFinding[] = [];
    let prospectiveItems: Prisma.OrderItemCreateWithoutOrderInput[] | undefined;
    const normalizedEffectivePaymentMethod = normalizeOrderPaymentMethod(effectivePaymentMethod);
    if (body.status === 'confirmed' && normalizedEffectivePaymentMethod === 'alipay' && !order.paidAt) {
      return NextResponse.json({ error: 'ALIPAY_PAYMENT_REQUIRED' }, { status: 409 });
    }
    if (
      body.status === 'confirmed'
      && normalizedEffectivePaymentMethod !== 'alipay'
      && !isPostDeliveryPaymentMethod(effectivePaymentMethod)
    ) {
      return NextResponse.json({ error: 'PAYMENT_METHOD_REQUIRED' }, { status: 409 });
    }
    if (requiresPaidAlipayRefund(body.status, normalizedEffectivePaymentMethod, order.paidAt)) {
      return NextResponse.json({ error: 'PAID_ORDER_REFUND_REQUIRED' }, { status: 409 });
    }

    if (body.status) {
      assertOrderTransition(order.status, body.status);
      updateData.status = body.status;
      if (!isAutoCloseableOrderStatus(body.status)) updateData.autoCloseAt = null;
    }

    if (body.items !== undefined) {
      if (!isAutoCloseableOrderStatus(order.status)) return NextResponse.json({ error: 'ORDER_ITEMS_LOCKED' }, { status: 409 });
      if (normalizedEffectivePaymentMethod === 'alipay' && (order.paidAt || order.paymentAttempts.length > 0)) {
        return NextResponse.json({ error: 'ORDER_ITEMS_LOCKED' }, { status: 409 });
      }
      const items = body.items;
      if (!Array.isArray(items)) {
        return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
      }
      // 改订单行价格沿用 orders.write。不另要求 pricing.write，也不在原有 MFA 之外加验证。
      const lineReview = await reviewCommerceLinesWithCatalog(
        (items as Array<Record<string, unknown>>).map(commerceLineRefFromRecord),
      );
      const lineDecision = decideCommerceLineReview(lineReview, body.confirmWarnings);
      if (!lineDecision.ok) return NextResponse.json(lineDecision.body, { status: lineDecision.status });
      confirmedLineWarnings = lineDecision.warnings;
      const pricedItems = (items as Array<Record<string, unknown>>).map((item) => {
        const rawPrice = item.price !== undefined ? item.price : item.unitPrice;
        const price = typeof rawPrice === 'number' ? rawPrice : Number(rawPrice);
        const quantity = typeof item.quantity === 'number' ? item.quantity : Number(item.quantity);
        return { ...item, price, quantity };
      });
      prospectiveItems = toOrderItemCreates(pricedItems);
      updateData.orderItems = {
        deleteMany: {},
        create: prospectiveItems,
      };
      try {
        const amounts = calculateOrderAmounts(
          pricedItems.map((item) => ({ unitPrice: item.price, quantity: item.quantity })),
          order.adjustments,
        );
        updateData.subtotal = amounts.subtotal;
        updateData.adjustmentTotal = amounts.adjustmentTotal;
        updateData.total = amounts.total;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'INVALID_ORDER_AMOUNT';
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    let confirmedInquiryId: string | null = null;
    if (Object.keys(updateData).length > 0) {
      if (isPlatformAdmin) {
        const consumedFailure = await consumeAdminOrderStepUp(user, stepUpToken);
        if (consumedFailure) return consumedFailure;
      }
      confirmedInquiryId = await prisma.$transaction(async (tx) => {
        if (accepting || body.items !== undefined) await assertOrderPricingResolved(tx, id, prospectiveItems);
        if (accepting && (body.items !== undefined || body.paymentMethod !== undefined)) {
          throw new Error('ORDER_APPROVAL_SAVE_CHANGES_FIRST');
        }
        await requirePhysicalStatus(tx, id, order.status, body.status);
        const acceptance = accepting ? await verifyMerchantOrderAcceptance(tx, id, body.approvalVersion) : null;
        if (body.status === 'cancelled') {
          // Claim cancellation before any history or resource releases. The payment
          // callback competes on the same row, so a stale unpaid snapshot cannot win.
          const cancelled = await tx.order.updateMany({
            where: { id, status: order.status, paidAt: null },
            data: { status: 'cancelled', autoCloseAt: null },
          });
          if (cancelled.count !== 1) throw new Error('ORDER_CANCELLATION_CONFLICT');
        }
        const eventCreates = [
          ...(body.status && body.status !== order.status ? [{
            type: 'status_changed', actorId: user.id, actorEmail: user.email,
            message: `${order.status} -> ${body.status}`,
            metadata: JSON.stringify({ fromStatus: order.status, toStatus: body.status, reason: body.reason || null }),
          }] : []),
          ...(body.items !== undefined ? [{
            type: 'items_updated',
            actorId: user.id,
            actorEmail: user.email,
            message: '订单商品已更新',
            metadata: confirmedLineWarnings.length
              ? JSON.stringify({ confirmedWarnings: confirmedLineWarnings })
              : null,
          }] : []),
        ];
        await tx.order.update({ where: { id, ...(acceptance ? { status: 'pending', archivedAt: null } : {}) }, data: {
          ...updateData,
          ...(body.status && body.status !== order.status ? {
            statusHistory: {
              create: {
                fromStatus: order.status,
                toStatus: body.status,
                actorId: user.id,
                actorEmail: user.email,
                reason: body.reason || null,
                ...(acceptance ? { metadata: acceptance.metadata } : {}),
              },
            },
          } : {}),
          ...(eventCreates.length ? { events: { create: eventCreates } } : {}),
        } });
        if (confirmedLineWarnings.length > 0) {
          await writeAuditLog({
            actorId: user.id,
            actorEmail: user.email,
            action: 'order.line_warnings_confirmed',
            resource: 'orders',
            targetType: 'Order',
            targetId: id,
            reason: '管理员确认订单行核对警告后保存',
            metadata: { confirmWarnings: true, warnings: confirmedLineWarnings },
          }, tx);
        }
        if (acceptance) {
          if (isPostDeliveryPaymentMethod(acceptance.order.paymentMethod)) await reserveOrderCredit(tx, id, user.id);
          await reserveOrderInventory(tx, id, user.id);
          await prepareOrderPurchases(tx, id, user);
          await tx.notification.create({
            data: {
              email: acceptance.order.email, role: 'customer', type: 'order_status_changed',
              title: '订单状态更新', content: `订单 ${id} 状态已更新为：${ORDER_STATUS_LABELS.confirmed}`,
              linkUrl: '/account/orders', metadata: JSON.stringify({ orderId: id, status: 'confirmed' }),
            },
          });
        }
        if (isInactiveOrderStatus(body.status) && !isInactiveOrderStatus(order.status)) {
          await closeOrderRepricing(tx, id, { id: user.id, email: user.email });
          if (isPostDeliveryPaymentMethod(effectivePaymentMethod)) await releaseOrderReceivableOnCancellation(tx, id, user.id);
          await releaseOrderInventory(tx, id, user.id);
          await restoreRedeemedOrderCoupons(tx, id);
          const originalPaidYuan = Math.round((order.total + (order.pointsDiscount || 0)) * 100) / 100;
          requirePointsRefund(await refundOrderPointsProportionally(tx, {
            orderId: id,
            refundYuan: originalPaidYuan,
            originalPaidYuan,
            actorUserId: user.id,
            reason: body.status === 'closed' ? '订单关闭退回积分' : '订单取消退回积分',
          }));
        }
        return acceptance?.order.inquiryId ?? null;
      }, { isolationLevel: 'Serializable' });
    }

    // On confirm: clear user's isNewUser flag
    if (confirmedInquiryId) {
      try {
        const inquiryRow = await prisma.inquiry.findUnique({
          where: { id: confirmedInquiryId },
          select: { userId: true },
        });
        if (inquiryRow?.userId) {
          await prisma.user.update({
            where: { id: inquiryRow.userId },
            data: { isNewUser: false },
          });
        }
      } catch (e) {
        console.error('[clear new user flag error]', e);
      }
    }

    if (!accepting && body.status && body.status !== order.status) {
      const statusLabel = (ORDER_STATUS_LABELS as Record<string, string>)[body.status] || body.status;
      await prisma.notification.create({
        data: {
          email: order.email,
          role: 'customer',
          type: 'order_status_changed',
          title: '订单状态更新',
          content: `订单 ${id} 状态已更新为：${statusLabel}`,
          linkUrl: '/account/orders',
          metadata: JSON.stringify({ orderId: id, status: body.status }),
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[order PATCH] error:', err);
    const message = err instanceof Error ? err.message : '';
    const approvalConflict = accepting && orderApprovalConflict(err);
    if (approvalConflict) return NextResponse.json(approvalConflict, { status: 409 });
    if ((err as { code?: string })?.code === 'P2025') return NextResponse.json({ error: '订单已变化，请重新查看。' }, { status: 409 });
    if (message === 'QUOTE_REPRICE_REQUIRED') return NextResponse.json({ error: '商品价格已变化，请先完成原订单价格复核', code: message }, { status: 409 });
    if (message === 'FULFILLMENT_RECORDS_REQUIRED') return NextResponse.json({ error: '请先按发货明细登记实际运送和签收情况。' }, { status: 409 });
    if (message === POINTS_REFUND_FAILED) {
      return NextResponse.json({ error: POINTS_REFUND_FAILED }, { status: 409 });
    }
    if (['CREDIT_LIMIT_EXCEEDED', 'CREDIT_ACCOUNT_SUSPENDED', 'CREDIT_USER_NOT_FOUND', 'RECEIVABLE_NOT_FOUND', 'INVALID_ORDER_TRANSITION', 'INSUFFICIENT_AVAILABLE_INVENTORY', 'ALIPAY_PAYMENT_REQUIRED', 'PAID_ORDER_REFUND_REQUIRED', 'ORDER_CANCELLATION_CONFLICT'].includes(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (['INVALID_ORDER_STATUS', 'INVALID_ORDER_AMOUNT'].includes(message)) return NextResponse.json({ error: message }, { status: 400 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
