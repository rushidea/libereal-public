import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { formatAlipayAmount, getAlipaySdk } from '@/lib/alipay';
import { getPublicSiteOrigin, isPublicHttpOrigin } from '@/lib/site-url';
import { reportError } from '@/lib/errorReporting';

export async function GET(req: NextRequest) {
  const outTradeNo = req.nextUrl.searchParams.get('outTradeNo');
  if (!outTradeNo) return NextResponse.json({ error: '缺少 outTradeNo' }, { status: 400 });

  const client = getAlipaySdk();
  if (!client) return NextResponse.json({ error: '支付宝支付暂未配置' }, { status: 503 });

  const topup = await prisma.pointsTopup.findUnique({ where: { outTradeNo } });
  if (!topup || topup.status !== 'pending' || !topup.outTradeNo) {
    return NextResponse.json({ error: '充值单无效' }, { status: 404 });
  }

  const siteUrl = getPublicSiteOrigin(req.nextUrl.origin);
  let paymentUrl: string;
  try {
    paymentUrl = client.sdk.pageExecute('alipay.trade.page.pay', 'GET', {
      returnUrl: `${siteUrl}/account/points?topup=${encodeURIComponent(topup.id)}`,
      ...(isPublicHttpOrigin(siteUrl) ? { notifyUrl: `${siteUrl}/api/payments/alipay/notify` } : {}),
      bizContent: {
        out_trade_no: topup.outTradeNo,
        total_amount: formatAlipayAmount(topup.amount),
        subject: topup.targetType === 'group' ? 'LIBEREAL 课题组积分充值' : 'LIBEREAL 个人积分充值',
        product_code: 'FAST_INSTANT_TRADE_PAY',
        timeout_express: '1d',
        qr_pay_mode: '1',
      },
    });
  } catch (error) {
    reportError(error, {
      tags: { integration: 'alipay', operation: 'points_topup_redirect' },
      extra: { topupId: topup.id, outTradeNo: topup.outTradeNo },
    });
    return NextResponse.json({ error: '支付宝付款签名失败' }, { status: 503 });
  }

  const response = NextResponse.redirect(paymentUrl, 302);
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return response;
}
