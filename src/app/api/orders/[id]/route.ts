import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession, requireAdmin } from '@/lib/session';
import type { Prisma } from '@prisma/client';
import { orderItemView, toOrderItemCreates } from '@/lib/commerce-records';
import { releaseOrderReceivableOnCancellation, reserveOrderCredit, settleOrderReceivable } from '@/lib/customer-credit';
import { assertOrderTransition, calculateOrderAmounts, isAutoCloseableOrderStatus, isInactiveOrderStatus, ORDER_STATUS_LABELS, requiresPaidAlipayRefund } from '@/lib/order-domain';
import { releaseOrderInventory, reserveOrderInventory } from '@/lib/inventory';
import { isPostDeliveryPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { getAlipayPaymentSummary } from '@/data/alipay-payment';
import { refundOrderPointsProportionally } from '@/lib/points-checkout-service';
import { canAccessOrganizationRecord } from '@/lib/organization-record-access';
import { requireOrganizationPermission } from '@/lib/organization-service';

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
  const callerEmail = user.email;
  const isAdmin = user.role === 'admin';

  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        orderItems: { orderBy: { position: 'asc' } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
        addressSnapshot: true,
        adjustments: { orderBy: { createdAt: 'asc' } },
        shipments: { orderBy: { createdAt: 'desc' }, include: { items: true } },
        events: { orderBy: { createdAt: 'asc' } },
        paymentAttempts: { where: { provider: 'alipay' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    if (!isAdmin) {
      let allowed = order.ownerScope === 'organization'
        ? Boolean(order.organizationId) && await canAccessOrganizationRecord(user.id, order.organizationId as string)
        : order.email === callerEmail;
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

    const { orderItems, paymentAttempts, ...rest } = order;
    return NextResponse.json({
      ...rest,
      items: orderItems.map(orderItemView),
      inquiry,
      payment: getAlipayPaymentSummary(order, paymentAttempts[0]),
    });
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
    const admin = await requireAdmin('orders.write');
    if (admin instanceof NextResponse) return admin;
    user = admin;
  }

  try {
    const body = await req.json();
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
      } else {
        const ownsPersonalOrder = order.ownerScope === 'personal'
          && (order.customerId === user.id || order.email === user.email);
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
      if (normalizedPaymentMethod !== currentPaymentMethod && (order.paidAt || order.paymentAttempts.length > 0)) {
        return NextResponse.json({ error: 'PAYMENT_METHOD_LOCKED' }, { status: 409 });
      }
      updateData.paymentMethod = normalizedPaymentMethod;
      effectivePaymentMethod = normalizedPaymentMethod;
    }

    const normalizedEffectivePaymentMethod = normalizeOrderPaymentMethod(effectivePaymentMethod);
    if (body.status === 'confirmed' && normalizedEffectivePaymentMethod === 'alipay' && !order.paidAt) {
      return NextResponse.json({ error: 'ALIPAY_PAYMENT_REQUIRED' }, { status: 409 });
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
      updateData.orderItems = {
        deleteMany: {},
        create: toOrderItemCreates(items),
      };
      try {
        const amounts = calculateOrderAmounts(
          (items as Array<{ price?: number; quantity?: number }>).map((item) => ({ unitPrice: item.price || 0, quantity: item.quantity || 1 })),
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

    if (Object.keys(updateData).length > 0) {
      await prisma.$transaction(async (tx) => {
        const eventCreates = [
          ...(body.status && body.status !== order.status ? [{
            type: 'status_changed', actorId: user.id, actorEmail: user.email,
            message: `${order.status} -> ${body.status}`,
            metadata: JSON.stringify({ fromStatus: order.status, toStatus: body.status, reason: body.reason || null }),
          }] : []),
          ...(body.items !== undefined ? [{ type: 'items_updated', actorId: user.id, actorEmail: user.email, message: '订单商品已更新' }] : []),
        ];
        await tx.order.update({ where: { id }, data: {
          ...updateData,
          ...(body.status && body.status !== order.status ? {
            statusHistory: {
              create: {
                fromStatus: order.status,
                toStatus: body.status,
                actorId: user.id,
                actorEmail: user.email,
                reason: body.reason || null,
              },
            },
          } : {}),
          ...(eventCreates.length ? { events: { create: eventCreates } } : {}),
        } });
        if (body.status === 'confirmed' && order.status !== 'confirmed') {
          if (isPostDeliveryPaymentMethod(effectivePaymentMethod)) await reserveOrderCredit(tx, id, user.id);
          await reserveOrderInventory(tx, id, user.id);
        }
        if (isInactiveOrderStatus(body.status) && !isInactiveOrderStatus(order.status)) {
          if (isPostDeliveryPaymentMethod(effectivePaymentMethod)) await releaseOrderReceivableOnCancellation(tx, id, user.id);
          await releaseOrderInventory(tx, id, user.id);
          const originalPaidYuan = Math.round((order.total + (order.pointsDiscount || 0)) * 100) / 100;
          await refundOrderPointsProportionally(tx, {
            orderId: id,
            refundYuan: originalPaidYuan,
            originalPaidYuan,
            actorUserId: user.id,
            reason: body.status === 'closed' ? '订单关闭退回积分' : '订单取消退回积分',
          });
        }
        if (body.status === 'completed' && order.status !== 'completed') {
          if (isPostDeliveryPaymentMethod(effectivePaymentMethod)) await settleOrderReceivable(tx, id, user.id);
        }
      });
    }

    // On confirm: clear user's isNewUser flag
    if (body.status === 'confirmed' && order.inquiryId) {
      try {
        const inquiryRow = await prisma.inquiry.findUnique({
          where: { id: order.inquiryId },
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

    // Status-change notification
    if (body.status && body.status !== order.status) {
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
    if (['CREDIT_LIMIT_EXCEEDED', 'CREDIT_ACCOUNT_SUSPENDED', 'RECEIVABLE_NOT_FOUND', 'INVALID_ORDER_TRANSITION', 'INSUFFICIENT_AVAILABLE_INVENTORY', 'ALIPAY_PAYMENT_REQUIRED', 'PAID_ORDER_REFUND_REQUIRED'].includes(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (['INVALID_ORDER_STATUS', 'INVALID_ORDER_AMOUNT'].includes(message)) return NextResponse.json({ error: message }, { status: 400 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
