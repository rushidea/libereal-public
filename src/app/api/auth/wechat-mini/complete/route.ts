import { NextRequest, NextResponse } from 'next/server';
import { signIn } from '@/lib/auth';
import { createPendingOAuthLink, setPendingOAuthLinkCookie } from '@/lib/account-linking';
import {
  authorizeWechatMiniCompletion,
  getWechatMiniBrowserSecretCookieName,
  releaseWechatMiniBrowserClaim,
  restoreWechatMiniUnlinkedClaim,
  WECHAT_MINI_CHALLENGE_STATUSES,
  WECHAT_MINI_LOGIN_PROVIDER_ID,
  wechatMiniBrowserSecretCookieOptions,
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

function clearBrowserSecretCookie(response: NextResponse, challengeId: string) {
  response.cookies.set(getWechatMiniBrowserSecretCookieName(challengeId), '', {
    ...wechatMiniBrowserSecretCookieOptions(),
    maxAge: 0,
  });
}

function readBrowserSecret(req: NextRequest, challengeId: string): string | null {
  return req.cookies.get(getWechatMiniBrowserSecretCookieName(challengeId))?.value ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as CompletePayload;
    const challengeId = payload.challengeId?.trim() ?? '';
    const callbackUrl = normalizeCallbackUrl(payload.callbackUrl);

    if (!challengeId) {
      return NextResponse.json({ error: '缺少 challengeId' }, { status: 400 });
    }

    let presentedSecret: string | null = null;
    try {
      presentedSecret = readBrowserSecret(req, challengeId);
    } catch {
      return NextResponse.json({ error: '登录请求无效' }, { status: 400 });
    }

    const decision = await authorizeWechatMiniCompletion(challengeId, presentedSecret);
    if (!decision.ok) {
      return NextResponse.json({ error: decision.error }, { status: decision.httpStatus });
    }

    if (decision.kind === 'linked') {
      const loginToken = decision.challenge.loginToken;
      if (!loginToken) {
        return NextResponse.json({ error: '微信授权尚未完成' }, { status: 409 });
      }
      try {
        const authRedirect = await signIn(WECHAT_MINI_LOGIN_PROVIDER_ID, {
          loginToken,
          redirect: false,
          redirectTo: callbackUrl,
        });
        let redirectUrl = typeof authRedirect === 'string' ? authRedirect : callbackUrl;
        const parsedRedirect = new URL(redirectUrl, req.nextUrl.origin);
        if (parsedRedirect.pathname === '/login/mfa') {
          parsedRedirect.searchParams.set('callbackUrl', callbackUrl);
          redirectUrl = `${parsedRedirect.pathname}${parsedRedirect.search}`;
        }
        const response = NextResponse.json({
          ok: true,
          status: WECHAT_MINI_CHALLENGE_STATUSES.linked,
          redirectUrl,
        });
        clearBrowserSecretCookie(response, decision.challenge.id);
        return response;
      } catch (error) {
        await releaseWechatMiniBrowserClaim(decision.challenge.id, decision.browserSecretHash, loginToken);
        throw error;
      }
    }

    const providerAccountId = decision.challenge.providerAccountId;
    if (!providerAccountId) {
      return NextResponse.json({ error: '微信授权尚未完成' }, { status: 409 });
    }
    try {
      await setPendingOAuthLinkCookie(createPendingOAuthLink(
        {
          provider: 'wechat',
          providerAccountId,
          type: 'oauth',
        },
        'wechat',
        {
          mode: 'register',
          oauthName: decision.challenge.oauthName ?? undefined,
          oauthImage: decision.challenge.oauthImage ?? undefined,
          oauthSex: decision.challenge.oauthSex ?? undefined,
        },
      ));
    } catch (error) {
      await restoreWechatMiniUnlinkedClaim(decision.challenge.id, decision.browserSecretHash);
      throw error;
    }
    const response = NextResponse.json({
      ok: true,
      status: WECHAT_MINI_CHALLENGE_STATUSES.unlinked,
      redirectUrl: '/register?wechat=unlinked',
    });
    clearBrowserSecretCookie(response, decision.challenge.id);
    return response;
  } catch (error) {
    console.error('[wechat-mini/complete]', error);
    return NextResponse.json({ error: '无法完成微信小程序登录' }, { status: 500 });
  }
}
