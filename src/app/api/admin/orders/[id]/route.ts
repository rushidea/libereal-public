import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { orderItemView } from '@/lib/commerce-records';
import { getAlipayPaymentSummary } from '@/data/alipay-payment';
import { releaseOrderReceivableOnCancellation, reserveOrderCredit, settleOrderReceivable } from '@/lib/customer-credit';
import { assertOrderTransition, isAutoCloseableOrderStatus, isInactiveOrderStatus, requiresPaidAlipayRefund } from '@/lib/order-domain';
import { restoreRedeemedOrderCoupons } from '@/lib/coupon-service';
import { releaseOrderInventory, reserveOrderInventory } from '@/lib/inventory';
import { orderStatusRequiresFinanceWrite, receivableOccupiesCredit } from '@/lib/order-finance-access';
import { requireAdmin } from '@/lib/session';
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
    const { orderItems, paymentAttempts, ...rest } = order;
    return NextResponse.json({
      order: {
        ...rest,
        items: orderItems.map(orderItemView),
        payment: getAlipayPaymentSummary(rest, paymentAttempts[0]),
      },
    });
  } catch (err) {
    console.error('[admin/orders/[id] GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const reader = await requireAdmin('orders.read');
  if (reader instanceof NextResponse) return reader;

  try {
    const { id } = await params;
    const { status, reason } = await req.json();

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
    const admin = await requireAdmin(orderStatusRequiresFinanceWrite({
      currentStatus: existing.status,
      nextStatus: status,
      paymentMethod: existing.paymentMethod,
      hasOpenReceivable,
    }) ? 'finance.write' : 'orders.write');
    if (admin instanceof NextResponse) return admin;

    const updateData: Prisma.OrderUpdateInput = {};
    const normalizedPaymentMethod = normalizeOrderPaymentMethod(existing.paymentMethod);
    if (status === 'confirmed' && normalizedPaymentMethod === 'alipay' && !existing.paidAt) {
      return NextResponse.json({ error: 'ALIPAY_PAYMENT_REQUIRED' }, { status: 409 });
    }
    if (requiresPaidAlipayRefund(status, existing.paymentMethod, existing.paidAt)) {
      return NextResponse.json({ error: 'PAID_ORDER_REFUND_REQUIRED' }, { status: 409 });
    }
    if (status) {
      assertOrderTransition(existing.status, status);
      updateData.status = status;
      if (!isAutoCloseableOrderStatus(status)) updateData.autoCloseAt = null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (status === 'cancelled') {
        // Claim cancellation before any history or resource releases. The payment
        // callback competes on the same row, so a stale unpaid snapshot cannot win.
        const cancelled = await tx.order.updateMany({
          where: { id, status: existing.status, paidAt: null },
          data: { status: 'cancelled', autoCloseAt: null },
        });
        if (cancelled.count !== 1) throw new Error('ORDER_CANCELLATION_CONFLICT');
      }
      const result = await tx.order.update({ where: { id }, data: {
        ...updateData,
        ...(status && status !== existing.status ? {
          statusHistory: {
            create: {
              fromStatus: existing.status,
              toStatus: status,
              actorId: admin.id,
              actorEmail: admin.email,
              reason: reason || 'admin_status_update',
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
      if (status === 'confirmed' && existing.status !== 'confirmed' && isPostDeliveryPaymentMethod(existing.paymentMethod)) await reserveOrderCredit(tx, id, admin.id);
      if (status === 'confirmed' && existing.status !== 'confirmed') await reserveOrderInventory(tx, id, admin.id);
      if (isInactiveOrderStatus(status) && !isInactiveOrderStatus(existing.status)) {
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
      if (status === 'completed' && existing.status !== 'completed' && isPostDeliveryPaymentMethod(existing.paymentMethod)) await settleOrderReceivable(tx, id, admin.id);
      if (status && status !== existing.status) await writeAuditLog({ actorId: admin.id, actorEmail: admin.email, action: 'order.status_changed', resource: 'orders', targetType: 'Order', targetId: id, before: { status: existing.status }, after: { status }, reason }, tx);
      return result;
    });
    return NextResponse.json({ order: updated });
  } catch (err) {
    console.error('[admin/orders/[id] PATCH] error:', err);
    const message = err instanceof Error ? err.message : '';
    if (message === POINTS_REFUND_FAILED) {
      return NextResponse.json({ error: POINTS_REFUND_FAILED }, { status: 409 });
    }
    if (['CREDIT_LIMIT_EXCEEDED', 'CREDIT_ACCOUNT_SUSPENDED', 'RECEIVABLE_NOT_FOUND', 'INVALID_ORDER_TRANSITION', 'INSUFFICIENT_AVAILABLE_INVENTORY', 'ALIPAY_PAYMENT_REQUIRED', 'PAID_ORDER_REFUND_REQUIRED', 'ORDER_CANCELLATION_CONFLICT'].includes(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message === 'INVALID_ORDER_STATUS') return NextResponse.json({ error: message }, { status: 400 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
