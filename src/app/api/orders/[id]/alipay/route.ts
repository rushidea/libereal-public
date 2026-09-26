import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession } from '@/lib/session';
import { alipayAmountToCents, getAlipaySdk } from '@/lib/alipay';
import { writeAuditLog } from '@/lib/audit';
import { canPayOrderWithAlipay, getAlipayPaymentExpiresAt } from '@/data/alipay-payment';
import { normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { OrganizationRbacError, requireOrganizationPermission } from '@/lib/organization-service';

function amountsEqualInCents(left: number, right: number): boolean {
  const leftCents = alipayAmountToCents(left);
  const rightCents = alipayAmountToCents(right);
  return leftCents !== null && rightCents !== null && leftCents === rightCents;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const client = getAlipaySdk();
  if (!client) return NextResponse.json({ error: '支付宝支付暂未配置' }, { status: 503 });

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      total: true,
      status: true,
      paymentMethod: true,
      paidAt: true,
      createdAt: true,
      customerId: true,
      organizationId: true,
      ownerScope: true,
      pointsPersonal: true,
      pointsGroup: true,
      pointsGroupId: true,
      pointsApplied: true,
      pointsDiscount: true,
    },
  });
  if (!order) return NextResponse.json({ error: '订单不存在' }, { status: 404 });
  if (order.ownerScope === 'organization' && order.organizationId) {
    if (order.customerId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      await requireOrganizationPermission(user.id, order.organizationId, 'organization.orders.create');
    } catch (error) {
      if (error instanceof OrganizationRbacError) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      throw error;
    }
  } else if (order.ownerScope === 'organization') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (order.email !== user.email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (normalizeOrderPaymentMethod(order.paymentMethod) !== 'alipay') return NextResponse.json({ error: '订单付款方式不匹配' }, { status: 409 });
  if (order.paidAt) return NextResponse.json({ error: '订单已付款' }, { status: 409 });
  if (!canPayOrderWithAlipay(order)) {
    return NextResponse.json({ error: '支付宝付款期限已过', expiresAt: getAlipayPaymentExpiresAt(order.createdAt).toISOString() }, { status: 410 });
  }

  // 兼容历史订单：新订单在下单时已经扣减积分，旧支付宝订单在付款前继续校验余额。
  if (!order.pointsApplied && (order.pointsPersonal > 0 || order.pointsGroup > 0) && order.customerId) {
    const { previewPointsRedeem } = await import('@/lib/points-checkout-service');
    const payableBefore = Math.round((order.total + (order.pointsDiscount || 0)) * 100) / 100;
    const preview = await previewPointsRedeem(prisma, order.customerId, payableBefore, {
      personalPoints: order.pointsPersonal,
      groupPoints: order.pointsGroup,
      groupId: order.pointsGroupId,
    });
    if (!preview.ok) {
      return NextResponse.json({ error: preview.error || '积分不足，请返回结账页调整后重新下单' }, { status: 409 });
    }
  }

  let attempt = await prisma.paymentAttempt.findFirst({
    where: { orderId: id, provider: 'alipay', status: { in: ['created', 'redirected'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (attempt && !amountsEqualInCents(attempt.amount, order.total)) {
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: 'superseded' },
    });
    attempt = null;
  }
  if (!attempt) {
    const outTradeNo = `LP${Date.now()}${Math.random().toString(36).slice(2, 8)}`.slice(0, 64);
    attempt = await prisma.paymentAttempt.create({ data: { orderId: id, provider: 'alipay', outTradeNo, amount: order.total } });
    await writeAuditLog({ actorId: user.id, actorEmail: user.email, action: 'payment.alipay_created', resource: 'payments', targetType: 'Order', targetId: id, after: { outTradeNo, amount: order.total } });
  }

  return NextResponse.json({
    redirectUrl: `/api/orders/${encodeURIComponent(id)}/alipay/redirect?attemptId=${encodeURIComponent(attempt.outTradeNo)}`,
    expiresAt: getAlipayPaymentExpiresAt(order.createdAt).toISOString(),
  });
}
