import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { WECHAT_MINI_CHALLENGE_STATUSES } from '@/lib/wechat-mini-auth';

export async function GET(req: NextRequest) {
  try {
    const challengeId = req.nextUrl.searchParams.get('challengeId')?.trim();
    if (!challengeId) {
      return NextResponse.json({ error: '缺少 challengeId' }, { status: 400 });
    }

    const challenge = await prisma.wechatMiniLoginChallenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        status: true,
        providerAccountId: true,
        userId: true,
        expiresAt: true,
      },
    });

    if (!challenge) {
      return NextResponse.json({ error: '登录请求不存在' }, { status: 404 });
    }

    if (
      challenge.status === WECHAT_MINI_CHALLENGE_STATUSES.pending
      && challenge.expiresAt <= new Date()
    ) {
      await prisma.wechatMiniLoginChallenge.update({
        where: { id: challenge.id },
        data: { status: WECHAT_MINI_CHALLENGE_STATUSES.expired },
      });
      return NextResponse.json({
        status: WECHAT_MINI_CHALLENGE_STATUSES.expired,
        expiresAt: challenge.expiresAt.toISOString(),
      });
    }

    return NextResponse.json({
      status: challenge.status,
      expiresAt: challenge.expiresAt.toISOString(),
      linked: Boolean(challenge.userId),
      needsRegistration: challenge.status === WECHAT_MINI_CHALLENGE_STATUSES.unlinked,
    });
  } catch (error) {
    console.error('[wechat-mini/status]', error);
    return NextResponse.json({ error: '无法读取微信小程序登录状态' }, { status: 500 });
  }
}
