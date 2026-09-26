import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { reserveOrderCredit } from '@/lib/customer-credit';
import { reserveOrderInventory } from '@/lib/inventory';
import { isPostDeliveryPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';

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

    const paymentMethod = normalizeOrderPaymentMethod(order.paymentMethod);
    const shouldConfirm = isPostDeliveryPaymentMethod(order.paymentMethod) || (paymentMethod === 'alipay' && Boolean(order.paidAt));
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: {
        quoteSent: true,
        quoteSentAt: new Date(),
        ...(shouldConfirm ? { status: 'confirmed', autoCloseAt: null } : {}),
        ...(shouldConfirm && order.status !== 'confirmed' ? {
          statusHistory: {
            create: {
              fromStatus: order.status,
              toStatus: 'confirmed',
              actorId: user.id,
              reason: 'quote_sent',
            },
          },
        } : {}),
      } });
      if (shouldConfirm && order.status !== 'confirmed') {
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
