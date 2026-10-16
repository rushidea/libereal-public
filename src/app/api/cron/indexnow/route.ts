import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronRequestAuthorized } from '@/lib/cron-auth';
import { submitBaiduPushUrls } from '@/lib/seo/baidu-push';
import {
  listRecentlyUpdatedStorefrontUrls,
  pingBingSitemap,
  submitIndexNowUrls,
} from '@/lib/seo/indexnow';

export const dynamic = 'force-dynamic';

const LOOKBACK_MS = 26 * 60 * 60 * 1000;

// 生产每日推送仍由 scripts/cron-indexnow.py 直接执行，不经过本路由。
// 若改用本入口，GET 或 POST 都要带 x-cron-secret，且 CRON_SECRET 必须已配置。
async function handle(req: NextRequest) {
  if (!isCronRequestAuthorized(req)) return cronUnauthorizedResponse();

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

export const GET = handle;
export const POST = handle;
