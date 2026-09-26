import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { orderItemView } from '@/lib/commerce-records';
import { getAlipayPaymentSummary } from '@/data/alipay-payment';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  const session = await requireAdmin('orders.read');
  if (session instanceof NextResponse) return session;

  try {
    const orders = await prisma.order.findMany({
      where: { archivedAt: { not: null } },
      orderBy: { archivedAt: 'desc' },
      take: 500,
      include: {
        orderItems: { orderBy: { position: 'asc' } },
        paymentAttempts: { where: { provider: 'alipay' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return NextResponse.json({
      orders: orders.map(({ orderItems, paymentAttempts, ...order }) => ({
        ...order,
        items: orderItems.map(orderItemView),
        payment: getAlipayPaymentSummary(order, paymentAttempts[0]),
      })),
    });
  } catch (err) {
    console.error("[admin/orders/archived GET]", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
