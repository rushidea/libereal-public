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
  if (process.env.PROMOTION_VERSION_CHECK_ENABLED === 'true'
    && (typeof (body as Record<string, unknown>).expectedVersion !== 'number'
      || !Number.isSafeInteger((body as Record<string, unknown>).expectedVersion))) {
    return NextResponse.json({ error: '请刷新活动版本后重试' }, { status: 428 });
  }
  try {
    return NextResponse.json({ promotion: withPromotionRepository((repository) => repository.save(body as Record<string, unknown>, admin.id, id)) });
  } catch (error) {
    const failure = promotionError(error);
    if (failure.status >= 500) console.error('[promotions PATCH]', error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}

/** 保留活动历史与审计记录，删除入口按结束活动处理。 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('pricing.write');
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  const versionText = req.headers.get('If-Match');
  if (process.env.PROMOTION_VERSION_CHECK_ENABLED === 'true' && (!versionText || !/^[1-9][0-9]*$/.test(versionText) || !Number.isSafeInteger(Number(versionText)))) {
    return NextResponse.json({ error: '请刷新活动版本后重试' }, { status: 428 });
  }
  try {
    return NextResponse.json({ promotion: withPromotionRepository((repository) => repository.save({ status: 'ended',
      ...(versionText && /^[1-9][0-9]*$/.test(versionText) ? { expectedVersion: Number(versionText) } : {}) }, admin.id, id)) });
  } catch (error) {
    const failure = promotionError(error);
    if (failure.status >= 500) console.error('[promotions DELETE]', error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}
