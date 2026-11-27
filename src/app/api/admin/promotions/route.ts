import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { promotionError, withPromotionRepository } from '@/lib/promotion-repository';
import { unifiedPromotionRuntimeEnabled } from '@/lib/unified-promotion-config';

export async function GET() {
  const admin = await requireAdmin('pricing.read');
  if (admin instanceof NextResponse) return admin;
  try {
    return NextResponse.json({ promotions: withPromotionRepository((repository) => repository.list()),
      idempotencyEnabled: process.env.PROMOTION_CREATE_IDEMPOTENCY_ENABLED === 'true', unifiedPricingEnabled: unifiedPromotionRuntimeEnabled(), actorId: admin.id });
  } catch (error) {
    console.error('[promotions GET]', error);
    const failure = promotionError(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin('pricing.write');
  if (admin instanceof NextResponse) return admin;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: '活动配置无效' }, { status: 400 });
  try {
    const requestKey = req.headers.get('Idempotency-Key') ?? undefined;
    if (requestKey !== undefined && process.env.PROMOTION_CREATE_IDEMPOTENCY_ENABLED !== 'true') {
      return NextResponse.json({ error: '活动创建幂等功能尚未启用' }, { status: 503 });
    }
    if (requestKey === undefined && process.env.PROMOTION_CREATE_IDEMPOTENCY_ENABLED === 'true') {
      return NextResponse.json({ error: '创建活动必须提供幂等请求键' }, { status: 400 });
    }
    if (requestKey !== undefined && req.headers.get('X-Promotion-Expected-Actor') !== admin.id) {
      return NextResponse.json({ error: '账号已变化，请切回原账号核对创建结果' }, { status: 409 });
    }
    const promotion = withPromotionRepository((repository) => repository.save(body as Record<string, unknown>, admin.id, undefined, requestKey));
    return NextResponse.json({ promotion }, { status: 201 });
  } catch (error) {
    const failure = promotionError(error);
    if (failure.status >= 500) console.error('[promotions POST]', error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}
