import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { orderItemView } from '@/lib/commerce-records';
import { releaseOrderReceivableOnCancellation, reserveOrderCredit, settleOrderReceivable } from '@/lib/customer-credit';
import { assertOrderTransition, isAutoCloseableOrderStatus, isInactiveOrderStatus, requiresPaidAlipayRefund } from '@/lib/order-domain';
import { releaseOrderInventory, reserveOrderInventory } from '@/lib/inventory';
import { requireAdmin, requireAdminStepUp } from '@/lib/session';
import { isAdminMfaScenarioEnabled } from '@/lib/admin-mfa-settings';
import { writeAuditLog } from '@/lib/audit';
import { isPostDeliveryPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { refundOrderPointsProportionally } from '@/lib/points-checkout-service';

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
      },
    });
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    const { orderItems, ...rest } = order;
    return NextResponse.json({ order: { ...rest, items: orderItems.map(orderItemView) } });
  } catch (err) {
    console.error('[admin/orders/[id] GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('orders.write');
  if (admin instanceof NextResponse) return admin;

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
    if ((isInactiveOrderStatus(status) || status === 'completed') && await isAdminMfaScenarioEnabled('finance.write')) {
      const financeAdmin = await requireAdminStepUp(admin);
      if (financeAdmin instanceof NextResponse) return financeAdmin;
    }

    const updated = await prisma.$transaction(async (tx) => {
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
        const originalPaidYuan = Math.round((existing.total + existing.pointsDiscount) * 100) / 100;
        await refundOrderPointsProportionally(tx, {
          orderId: id,
          refundYuan: originalPaidYuan,
          originalPaidYuan,
          actorUserId: admin.id,
          reason: status === 'closed' ? '管理员关闭订单退回积分' : '管理员取消订单退回积分',
        });
      }
      if (status === 'completed' && existing.status !== 'completed' && isPostDeliveryPaymentMethod(existing.paymentMethod)) await settleOrderReceivable(tx, id, admin.id);
      if (status && status !== existing.status) await writeAuditLog({ actorId: admin.id, actorEmail: admin.email, action: 'order.status_changed', resource: 'orders', targetType: 'Order', targetId: id, before: { status: existing.status }, after: { status }, reason }, tx);
      return result;
    });
    return NextResponse.json({ order: updated });
  } catch (err) {
    console.error('[admin/orders/[id] PATCH] error:', err);
    const message = err instanceof Error ? err.message : '';
    if (['CREDIT_LIMIT_EXCEEDED', 'CREDIT_ACCOUNT_SUSPENDED', 'RECEIVABLE_NOT_FOUND', 'INVALID_ORDER_TRANSITION', 'INSUFFICIENT_AVAILABLE_INVENTORY', 'ALIPAY_PAYMENT_REQUIRED', 'PAID_ORDER_REFUND_REQUIRED'].includes(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    if (message === 'INVALID_ORDER_STATUS') return NextResponse.json({ error: message }, { status: 400 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
