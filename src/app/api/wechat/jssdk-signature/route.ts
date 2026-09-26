import { NextRequest, NextResponse } from 'next/server';
import { getEphemeralStore } from '@/lib/ephemeral-store';
import { reportError } from '@/lib/errorReporting';
import { getPublicSiteOrigin } from '@/lib/site-url';
import { getWechatJsSdkSignature } from '@/lib/wechat-jssdk';

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function requestIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
}

function normalizePromotionUrl(value: unknown, req: NextRequest): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const allowedOrigins = new Set([getPublicSiteOrigin()]);
    if (process.env.NODE_ENV !== 'production') allowedOrigins.add(req.nextUrl.origin);
    if (!allowedOrigins.has(url.origin) || !url.pathname.startsWith('/promotions/')) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const ip = requestIp(req);
  const now = Date.now();
  const windowStart = now - (now % RATE_WINDOW_MS);
  const count = await getEphemeralStore().increment(`rate-limit:wechat-jssdk:${ip}:${windowStart}`, RATE_WINDOW_MS);
  if (count > RATE_LIMIT) {
    return NextResponse.json({ error: '请求过于频繁' }, {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil((windowStart + RATE_WINDOW_MS - now) / 1000)) },
    });
  }

  try {
    const body = await req.json().catch(() => null) as { url?: unknown } | null;
    const url = normalizePromotionUrl(body?.url, req);
    if (!url) return NextResponse.json({ error: '无效的促销页面地址' }, { status: 400 });
    const config = await getWechatJsSdkSignature(url);
    return NextResponse.json(config, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    reportError(error, { tags: { route: 'wechat.jssdk-signature' } });
    if (error instanceof Error && error.message === 'WECHAT_JSSDK_NOT_CONFIGURED') {
      return NextResponse.json({ error: '微信分享服务尚未配置' }, { status: 503 });
    }
    return NextResponse.json({ error: '微信分享配置失败' }, { status: 502 });
  }
}
