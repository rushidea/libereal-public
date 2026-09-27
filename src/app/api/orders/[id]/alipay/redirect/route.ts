import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession } from '@/lib/session';
import { formatAlipayAmount, alipayAmountToCents, getAlipaySdk } from '@/lib/alipay';
import { getPublicSiteOrigin, isPublicHttpOrigin } from '@/lib/site-url';
import { canPayOrderWithAlipay, formatAlipayTimeExpire } from '@/data/alipay-payment';
import { reportError } from '@/lib/errorReporting';
import { OrganizationRbacError, requireOrganizationPermission } from '@/lib/organization-service';
import { isActivePaymentAttemptStatus } from '@/lib/payment-concurrency';

function amountsEqualInCents(left: number, right: number): boolean {
  const leftCents = alipayAmountToCents(left);
  const rightCents = alipayAmountToCents(right);
  return leftCents !== null && rightCents !== null && leftCents === rightCents;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;

  const { id } = await params;
  const attemptId = new URL(req.url).searchParams.get('attemptId');
  if (!attemptId) return NextResponse.json({ error: '付款请求不存在' }, { status: 400 });

  const client = getAlipaySdk();
  if (!client) return NextResponse.json({ error: '支付宝支付暂未配置' }, { status: 503 });

  const attempt = await prisma.paymentAttempt.findUnique({
    where: { outTradeNo: attemptId },
    include: { order: { select: { id: true, email: true, total: true, status: true, paymentMethod: true, paidAt: true, createdAt: true, customerId: true, organizationId: true, ownerScope: true } } },
  });
  if (!attempt || attempt.orderId !== id || attempt.provider !== 'alipay') {
    return NextResponse.json({ error: '付款请求不存在' }, { status: 404 });
  }
  if (attempt.order.ownerScope === 'organization' && attempt.order.organizationId) {
    if (attempt.order.customerId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      await requireOrganizationPermission(user.id, attempt.order.organizationId, 'organization.orders.create');
    } catch (error) {
      if (error instanceof OrganizationRbacError) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      throw error;
    }
  } else if (attempt.order.ownerScope === 'organization') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (attempt.order.email !== user.email) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!amountsEqualInCents(attempt.amount, attempt.order.total)) {
    return NextResponse.json({ error: '订单金额已变更，请重新发起支付' }, { status: 409 });
  }
  if (!canPayOrderWithAlipay(attempt.order) || !isActivePaymentAttemptStatus(attempt.status)) {
    return NextResponse.json({ error: '订单付款状态不允许继续支付' }, { status: 409 });
  }

  const siteUrl = getPublicSiteOrigin(new URL(req.url).origin);
  let paymentUrl: string;
  try {
    paymentUrl = client.sdk.pageExecute('alipay.trade.page.pay', 'GET', {
      returnUrl: `${siteUrl}/payments/alipay/return?orderId=${encodeURIComponent(id)}`,
      ...(isPublicHttpOrigin(siteUrl) ? { notifyUrl: `${siteUrl}/api/payments/alipay/notify` } : {}),
      bizContent: {
        out_trade_no: attempt.outTradeNo,
        total_amount: formatAlipayAmount(attempt.amount),
        subject: `LIBEREAL 订单 ${id}`,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        timeout_express: '1d',
        time_expire: formatAlipayTimeExpire(attempt.order.createdAt),
        qr_pay_mode: '1',
      },
    });
  } catch (error) {
    reportError(error, {
      tags: { integration: 'alipay', operation: 'page_pay_redirect' },
      extra: { orderId: id, outTradeNo: attempt.outTradeNo },
      user: { id: user.id, email: user.email },
    });
    return NextResponse.json(
      { error: '支付宝付款签名失败，请联系网站管理员', code: 'ALIPAY_SIGNING_FAILED' },
      { status: 503 },
    );
  }

  const response = NextResponse.redirect(paymentUrl, 302);
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
