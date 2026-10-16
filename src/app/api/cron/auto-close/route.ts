import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronRequestAuthorized } from '@/lib/cron-auth';
import { closeStalePendingOrders, reconcilePendingAlipayOrderPoints } from '@/lib/order-auto-close';

export const dynamic = 'force-dynamic';

// 定时任务入口：由系统 crontab 每 5 分钟调用一次。
// 鉴权与另外两个 /api/cron/* 相同：CRON_SECRET 去掉首尾空白后非空，且请求头
// x-cron-secret 与之相同。GET 与 POST 均可。密钥缺失时一律 401。
// 现有 crontab 无需改命令：
//   */5 * * * * curl -fsS -H "x-cron-secret: $CRON_SECRET" http://localhost:3000/api/cron/auto-close
async function handle(req: NextRequest) {
  if (!isCronRequestAuthorized(req)) return cronUnauthorizedResponse();

  try {
    const reconciliation = await reconcilePendingAlipayOrderPoints(100);
    const result = await closeStalePendingOrders(new Date(), 100);
    return NextResponse.json({ ok: true, ...reconciliation, ...result });
  } catch (err) {
    console.error('[cron/auto-close] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
