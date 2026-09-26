import { NextRequest, NextResponse } from 'next/server';
import { signIn } from '@/lib/auth';
import { createPendingOAuthLink, setPendingOAuthLinkCookie } from '@/lib/account-linking';
import { prisma } from '@/lib/prisma';
import {
  WECHAT_MINI_CHALLENGE_STATUSES,
  WECHAT_MINI_LOGIN_PROVIDER_ID,
} from '@/lib/wechat-mini-auth';

type CompletePayload = {
  challengeId?: string;
  callbackUrl?: string;
};

function normalizeCallbackUrl(callbackUrl: string | undefined): string {
  if (!callbackUrl?.trim()) return '/account';
  if (!callbackUrl.startsWith('/') || callbackUrl.startsWith('//')) return '/account';
  return callbackUrl;
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as CompletePayload;
    const challengeId = payload.challengeId?.trim();
    const callbackUrl = normalizeCallbackUrl(payload.callbackUrl);

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
        loginToken: true,
        oauthName: true,
        oauthImage: true,
        oauthSex: true,
        expiresAt: true,
      },
    });

    if (!challenge) {
      return NextResponse.json({ error: '登录请求不存在' }, { status: 404 });
    }
    if (challenge.expiresAt <= new Date()) {
      await prisma.wechatMiniLoginChallenge.update({
        where: { id: challenge.id },
        data: { status: WECHAT_MINI_CHALLENGE_STATUSES.expired, loginToken: null },
      });
      return NextResponse.json({ error: '登录请求已过期，请重新尝试' }, { status: 410 });
    }

    if (challenge.status === WECHAT_MINI_CHALLENGE_STATUSES.linked && challenge.loginToken) {
      const authRedirect = await signIn(WECHAT_MINI_LOGIN_PROVIDER_ID, {
        loginToken: challenge.loginToken,
        redirect: false,
        redirectTo: callbackUrl,
      });
      let redirectUrl = typeof authRedirect === 'string' ? authRedirect : callbackUrl;
      const parsedRedirect = new URL(redirectUrl, req.nextUrl.origin);
      if (parsedRedirect.pathname === '/login/mfa') {
        parsedRedirect.searchParams.set('callbackUrl', callbackUrl);
        redirectUrl = `${parsedRedirect.pathname}${parsedRedirect.search}`;
      }
      return NextResponse.json({ ok: true, status: WECHAT_MINI_CHALLENGE_STATUSES.linked, redirectUrl });
    }

    if (challenge.status === WECHAT_MINI_CHALLENGE_STATUSES.unlinked && challenge.providerAccountId) {
      await setPendingOAuthLinkCookie(createPendingOAuthLink(
        {
          provider: 'wechat',
          providerAccountId: challenge.providerAccountId,
          type: 'oauth',
        },
        'wechat',
        {
          mode: 'register',
          oauthName: challenge.oauthName ?? undefined,
          oauthImage: challenge.oauthImage ?? undefined,
          oauthSex: challenge.oauthSex ?? undefined,
        },
      ));
      await prisma.wechatMiniLoginChallenge.update({
        where: { id: challenge.id },
        data: { status: WECHAT_MINI_CHALLENGE_STATUSES.consumed, completedAt: new Date() },
      });
      return NextResponse.json({
        ok: true,
        status: WECHAT_MINI_CHALLENGE_STATUSES.unlinked,
        redirectUrl: '/register?wechat=unlinked',
      });
    }

    return NextResponse.json({ error: '微信授权尚未完成' }, { status: 409 });
  } catch (error) {
    console.error('[wechat-mini/complete]', error);
    return NextResponse.json({ error: '无法完成微信小程序登录' }, { status: 500 });
  }
}
