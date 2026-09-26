import { signIn } from '@/lib/auth';
import { NextRequest } from 'next/server';
import {
  getWeChatSignInProviderId,
  isWeChatInAppBrowser,
  isWeChatMpOAuthConfigured,
  shouldUseWeChatMiniProgramLogin,
} from '@/lib/wechat-auth';
import { publicSiteUrl } from '@/lib/site-url';

/**
 * Server-side WeChat sign-in entry: picks QR (desktop) vs app OAuth (mobile)
 * and starts OAuth via Auth.js POST flow (GET /signin/{provider} is unsupported).
 */
export async function GET(req: NextRequest) {
  const callbackUrl = req.nextUrl.searchParams.get('callbackUrl') ?? '/';
  const ua = req.headers.get('user-agent') ?? '';
  const inWeChat = isWeChatInAppBrowser(ua);

  if (shouldUseWeChatMiniProgramLogin(ua)) {
    const url = new URL(publicSiteUrl('/login/wechat-mini'));
    if (callbackUrl) {
      url.searchParams.set('callbackUrl', callbackUrl);
    }
    return Response.redirect(url);
  }

  if (inWeChat && !isWeChatMpOAuthConfigured()) {
    const loginUrl = publicSiteUrl('/login');
    const url = new URL(loginUrl);
    url.searchParams.set('wechat', 'inapp-unavailable');
    if (callbackUrl && callbackUrl !== '/') {
      url.searchParams.set('callbackUrl', callbackUrl);
    }
    return Response.redirect(url);
  }

  const provider = getWeChatSignInProviderId(ua);
  return signIn(provider, { redirectTo: callbackUrl });
}
