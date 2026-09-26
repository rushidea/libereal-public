import { NextRequest, NextResponse } from 'next/server';
import { foundationEnabled, promotionError, withPromotionRepository } from '@/lib/promotion-repository';
import { getEphemeralStore } from '@/lib/ephemeral-store';

/** 公开接口只返回活动参数及商品身份，不返回数据库价格或客户资料。 */
export async function POST(req: NextRequest) {
  if (!foundationEnabled()) return NextResponse.json({ enabled: false }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const requests = await getEphemeralStore().increment(`promotion-bindings:${ip}:${Math.floor(Date.now() / 60000)}`, 60000);
    if (requests > 120) return NextResponse.json({ error: '请求较频繁，请稍后重试' }, { status: 429 });
    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 }); }
    if (!Array.isArray(body) || body.length > 200) return NextResponse.json({ error: '商品列表无效' }, { status: 400 });
    const data = withPromotionRepository((repository, db) => {
      const resolved = body.map((raw: unknown, index: number) => {
        if (!raw || typeof raw !== 'object') throw new Error('INVALID_PROMOTION_PRODUCT');
        const item = raw as Record<string, unknown>;
        const productId = typeof item.productId === 'string' ? item.productId : '';
        const catalog = typeof item.catalogNumber === 'string' ? item.catalogNumber : '';
        const brand = typeof item.brand === 'string' ? item.brand : '';
        const variantId = typeof item.variantId === 'string' ? item.variantId : null;
        type Product = { id: string; catalogNumber: string };
        if (variantId) {
          const variant = db.prepare(`SELECT v.id, v.productId, p.catalogNumber FROM ProductVariant v JOIN Product p ON p.id=v.productId
            WHERE v.id=? AND p.hazardous=0`).get(variantId) as { id: string; productId: string; catalogNumber: string } | undefined;
          if (!variant || (productId && productId !== variant.productId && productId !== variant.catalogNumber)) throw new Error('INVALID_PROMOTION_VARIANT');
          return { id: String(index), productId: variant.productId, variantId: variant.id };
        }
        let product = db.prepare('SELECT id,catalogNumber FROM Product WHERE id=? AND hazardous=0').get(productId) as Product | undefined;
        if (!product) {
          const matches = db.prepare('SELECT id,catalogNumber FROM Product WHERE catalogNumber=? AND brand=? AND hazardous=0 LIMIT 2').all(catalog || productId, brand) as Product[];
          if (matches.length === 1) product = matches[0];
        }
        return { id: String(index), productId: product?.id ?? '', variantId: null };
      });
      return { resolved, campaigns: repository.activeForProducts(resolved.map((item) => item.productId).filter(Boolean)) };
    });
    return NextResponse.json({ enabled: true, ...data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const failure = promotionError(error);
    if (failure.status >= 500) console.error('[promotion bindings]', error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}
