import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Build a per-request CSP with a fresh nonce.
 *
 * - Next.js emits framework bootstrap inline scripts that are not currently
 *   annotated with this proxy nonce in our app, so a nonce-only CSP
 *   blocks hydration in production.
 * - Keep the script source list narrow, but allow inline framework bootstrap
 *   code so the app can run correctly behind Nginx/PM2.
 */
export function buildCsp(isProd: boolean): string {
  const scriptSrc = isProd
    ? "'self' 'unsafe-inline' https://challenges.cloudflare.com https://trtc.io"
    : "'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://trtc.io";
  // Knocket loads sdk.js and sdk.css from trtc.io, then calls api.trtc.io.
  // Live chat uses Tencent IM (China production hosts). Dynamic backups replace
  // the leading * with an app id or random prefix on *.my-imcloud.com / *.my-cpaas.com.
  const connectSrc = [
    "'self'",
    'https://challenges.cloudflare.com',
    'https://api.minimaxi.com',
    'https://www.jbr-pub.org.cn',
    'https://nature.com',
    'https://www.sciencenet.cn',
    'https://trtc.io',
    'https://api.trtc.io',
    'https://events.im.qcloud.com',
    'https://web.sdk.qcloud.com',
    'https://web.sdk.cloud.tencent.cn',
    'https://web.sdk.tencent.cn',
    'https://*.my-imcloud.com',
    'wss://wss.im.qcloud.com',
    'wss://wssv6.im.qcloud.com',
    'wss://wss.tim.qq.com',
    'wss://wss.im.tencent.cn',
    'wss://162.14.13.203',
    'wss://*.my-imcloud.com',
    'wss://*.my-cpaas.com',
  ].join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://trtc.io",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com https://console.trtc.io",
    "media-src 'self' https://console.trtc.io",
    `connect-src ${connectSrc}`,
    "frame-src 'self' https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self' https://openapi.alipay.com https://openapi-sandbox.dl.alipaydev.com",
    "frame-ancestors 'self'",
  ].join('; ');
}

function hasSessionCookie(request: NextRequest): boolean {
  return [
    'authjs.session-token',
    '__Secure-authjs.session-token',
    'next-auth.session-token',
    '__Secure-next-auth.session-token',
  ].some(name => Boolean(request.cookies.get(name)?.value));
}

function applyProxyHeaders(response: NextResponse, request: NextRequest, isProd: boolean): NextResponse {
  const deviceType = request.cookies.get('device-type')?.value;
  if (!deviceType) {
    const ua = request.headers.get('user-agent') || '';
    const isMobile = /iPhone|iPad|iPod|Android|Mobile|BlackBerry|Windows Phone/i.test(ua);
    response.cookies.set('device-type', isMobile ? 'mobile' : 'desktop', {
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  response.headers.set('Content-Security-Policy', buildCsp(isProd));
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  if (isProd) {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  return response;
}

export function proxy(request: NextRequest) {
  const indexNowKey = process.env.INDEXNOW_KEY?.trim() ?? '';
  if (
    /^[a-zA-Z0-9-]{8,128}$/.test(indexNowKey) &&
    request.nextUrl.pathname === `/${indexNowKey}.txt`
  ) {
    return new NextResponse(indexNowKey, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  // Generate a fresh per-request nonce
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isProd = process.env.NODE_ENV === 'production';

  if (request.nextUrl.pathname === '/login-v2') {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    const response = NextResponse.redirect(loginUrl);
    response.headers.set('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
    return response;
  }

  if (request.nextUrl.pathname === '/account/points' && !hasSessionCookie(request)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = 'callbackUrl=/account/points';
    return NextResponse.redirect(loginUrl);
  }

  // Forward nonce to downstream via request header (consumed by Next.js)
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  return applyProxyHeaders(response, request, isProd);
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|sitemaps/).*)',
  ],
};
