import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { reserveOrderCredit } from '@/lib/customer-credit';
import { reserveOrderInventory } from '@/lib/inventory';
import { isPostDeliveryPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import {
  assertOrderTransition,
  canEnterOrderQuoteFlow,
  orderQuoteStatusRejectionMessage,
  UNPAID_ORDER_QUOTE_CONFIRM_REJECTION,
} from '@/lib/order-domain';

const CONFIRMATION_CONFLICTS = [
  'CREDIT_LIMIT_EXCEEDED',
  'CREDIT_ACCOUNT_SUSPENDED',
  'CREDIT_USER_NOT_FOUND',
  'RECEIVABLE_NOT_FOUND',
  'INSUFFICIENT_AVAILABLE_INVENTORY',
];

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireAdmin('orders.write');
  if (user instanceof NextResponse) return user;

  try {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    // 终态和已履约状态不能从报价接口改回已确认。只允许未付款发送报价、待确认进入已确认。
    if (!canEnterOrderQuoteFlow(order.status)) {
      return NextResponse.json({ error: orderQuoteStatusRejectionMessage(order.status) }, { status: 409 });
    }

    const paymentMethod = normalizeOrderPaymentMethod(order.paymentMethod);
    const shouldConfirm = isPostDeliveryPaymentMethod(order.paymentMethod) || (paymentMethod === 'alipay' && Boolean(order.paidAt));
    if (shouldConfirm) {
      try {
        assertOrderTransition(order.status, 'confirmed');
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (message === 'INVALID_ORDER_TRANSITION' || message === 'INVALID_ORDER_STATUS') {
          return NextResponse.json({ error: UNPAID_ORDER_QUOTE_CONFIRM_REJECTION }, { status: 409 });
        }
        throw error;
      }
    }

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id, status: order.status },
        data: {
          quoteSent: true,
          quoteSentAt: new Date(),
          ...(shouldConfirm ? { status: 'confirmed', autoCloseAt: null } : {}),
        },
      });
      if (claimed.count !== 1) throw new Error('INVALID_ORDER_TRANSITION');

      if (shouldConfirm) {
        await tx.orderStatusHistory.create({
          data: {
            orderId: id,
            fromStatus: order.status,
            toStatus: 'confirmed',
            actorId: user.id,
            reason: 'quote_sent',
          },
        });
        // 与 PATCH /api/orders/:id、PATCH /api/admin/orders/:id 确认路径相同：
        // 先交货后付款扣授信，再按商品级库存账户预占。#160 规格库存尚未合入。
        if (isPostDeliveryPaymentMethod(order.paymentMethod)) await reserveOrderCredit(tx, id, user.id);
        await reserveOrderInventory(tx, id, user.id);
      }
      await enqueueBackgroundTask('email.send', {
        kind: 'quote',
        to: order.email,
        subject: shouldConfirm ? 'LIBEREAL · 订单确认' : 'LIBEREAL · 报价通知',
        message: shouldConfirm ? '订单已确认，请查看订单详情。' : '报价已发送，请在订单详情中完成支付宝付款。',
        path: '/account/orders',
      }, {
        priority: 5,
        dedupeKey: `order-confirmation-email:${id}`,
      }, tx);
    });

    await prisma.notification.create({
      data: {
        email: order.email,
        role: 'customer',
        type: 'quote_received',
        title: shouldConfirm ? '订单确认' : '报价通知',
        content: shouldConfirm ? '订单已确认，请查看订单详情' : '报价已发送，请在订单详情中完成支付宝付款',
        linkUrl: '/account/orders',
        metadata: JSON.stringify({ orderId: id }),
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[orders/[id]/quote POST] error:', err);
    const message = err instanceof Error ? err.message : '';
    if (message === 'INVALID_ORDER_TRANSITION' || message === 'INVALID_ORDER_STATUS') {
      return NextResponse.json({ error: '订单状态已变化，不能确认报价。' }, { status: 409 });
    }
    if (CONFIRMATION_CONFLICTS.includes(message)) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
