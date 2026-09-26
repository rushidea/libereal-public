import { NextRequest, NextResponse } from 'next/server';
import {
  listRecentlyUpdatedStorefrontUrls,
  pingBingSitemap,
  submitIndexNowUrls,
} from '@/lib/seo/indexnow';
import { submitBaiduPushUrls } from '@/lib/seo/baidu-push';

export const dynamic = 'force-dynamic';

const LOOKBACK_MS = 26 * 60 * 60 * 1000;

function authorizeCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return (req.headers.get('x-cron-secret') ?? '') === secret;
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const raw = req.headers.get('x-real-ip') ?? '';
  const candidate = raw || ip;
  return candidate === '127.0.0.1' || candidate === '::1' || candidate === 'localhost';
}

export async function GET(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const since = new Date(Date.now() - LOOKBACK_MS);
    const urls = await listRecentlyUpdatedStorefrontUrls(since);
    const indexNow = await submitIndexNowUrls(urls);
    const baiduPush = await submitBaiduPushUrls(urls);
    const sitemapPing = await pingBingSitemap();
    return NextResponse.json({
      ok: !indexNow.error && !baiduPush.error,
      since: since.toISOString(),
      urlCount: urls.length,
      indexNow,
      baiduPush,
      sitemapPing,
    });
  } catch (err) {
    console.error('[cron/indexnow] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
