import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAlipaySdk } from '@/lib/alipay';
import { getUserPointsBalance } from '@/lib/points-checkout-service';

/**
 * 创建支付宝积分充值单（个人或课题组，1 元 = 1 分）。
 * 实际入账在支付宝异步通知中完成。
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getAlipaySdk();
  if (!client) {
    return NextResponse.json({ error: '支付宝支付暂未配置' }, { status: 503 });
  }

  let body: { targetType?: string; points?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 });
  }

  const points = Math.floor(Number(body.points));
  if (!Number.isFinite(points) || points <= 0 || points > 1_000_000) {
    return NextResponse.json({ error: '充值积分数量无效' }, { status: 400 });
  }

  const targetType = body.targetType === 'group' ? 'group' : 'personal';
  const balance = await getUserPointsBalance(prisma, session.user.id as string);
  if (!balance) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (targetType === 'group' && (!balance.group || !balance.group.usable)) {
    return NextResponse.json({
      error: balance.group?.status === 'pending'
        ? '课题组待审核通过后方可充值'
        : '未加入可用课题组，无法充值到课题组',
    }, { status: 400 });
  }

  const outTradeNo = `PT${Date.now()}${Math.random().toString(36).slice(2, 8)}`.slice(0, 64);
  const amount = points; // 1:1

  const topup = await prisma.pointsTopup.create({
    data: {
      userId: session.user.id as string,
      targetType,
      groupId: targetType === 'group' ? balance.group!.id : null,
      points,
      amount,
      status: 'pending',
      outTradeNo,
    },
  });

  // 复用 PaymentAttempt 表不合适；充值跳转走专用 redirect
  return NextResponse.json({
    topupId: topup.id,
    outTradeNo,
    amount,
    points,
    targetType,
    redirectUrl: `/api/points/topup/alipay/redirect?outTradeNo=${encodeURIComponent(outTradeNo)}`,
  });
}
