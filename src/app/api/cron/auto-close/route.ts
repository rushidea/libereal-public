import { NextRequest, NextResponse } from 'next/server';
import { closeStalePendingOrders, reconcilePendingAlipayOrderPoints } from '@/lib/order-auto-close';

export const dynamic = 'force-dynamic';

// 定时任务入口：由系统 crontab / 部署平台定时器每 5 分钟调用一次。
// 调用方式（crontab 示例）：
//   */5 * * * * curl -fsS -H "x-cron-secret: <CRON_SECRET>" http://localhost:3000/api/cron/auto-close
// 环境变量 CRON_SECRET 为空时仅允许本机回环地址（凭 IP 粗略防护），生产必须配置 CRON_SECRET。
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.get('x-cron-secret') ?? '';
    if (header !== secret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } else {
    // 未配置 secret：仅放行明确标识的本机回环地址；空来源 IP（无代理头）或非回环一律拒绝，
    // 避免生产进程监听非本机地址时被未带代理头的请求绕过
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
    const raw = req.headers.get('x-real-ip') ?? '';
    const candidate = raw || ip;
    if (!(candidate === '127.0.0.1' || candidate === '::1' || candidate === 'localhost')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  try {
    const reconciliation = await reconcilePendingAlipayOrderPoints(100);
    const result = await closeStalePendingOrders(new Date(), 100);
    return NextResponse.json({ ok: true, ...reconciliation, ...result });
  } catch (err) {
    console.error('[cron/auto-close] error:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
