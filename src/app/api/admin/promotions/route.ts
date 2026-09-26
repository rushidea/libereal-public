import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { promotionError, withPromotionRepository } from '@/lib/promotion-repository';

export async function GET() {
  const admin = await requireAdmin('pricing.read');
  if (admin instanceof NextResponse) return admin;
  try {
    return NextResponse.json({ promotions: withPromotionRepository((repository) => repository.list()) });
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
    const promotion = withPromotionRepository((repository) => repository.save(body as Record<string, unknown>, admin.id));
    return NextResponse.json({ promotion }, { status: 201 });
  } catch (error) {
    const failure = promotionError(error);
    if (failure.status >= 500) console.error('[promotions POST]', error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}
