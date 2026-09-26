import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { promotionError, withPromotionRepository } from '@/lib/promotion-repository';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('pricing.write');
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: '活动配置无效' }, { status: 400 });
  try {
    return NextResponse.json({ promotion: withPromotionRepository((repository) => repository.save(body as Record<string, unknown>, admin.id, id)) });
  } catch (error) {
    const failure = promotionError(error);
    if (failure.status >= 500) console.error('[promotions PATCH]', error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}

/** 保留活动历史与审计记录，删除入口按结束活动处理。 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('pricing.write');
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  try {
    return NextResponse.json({ promotion: withPromotionRepository((repository) => repository.save({ status: 'ended' }, admin.id, id)) });
  } catch (error) {
    const failure = promotionError(error);
    if (failure.status >= 500) console.error('[promotions DELETE]', error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}
