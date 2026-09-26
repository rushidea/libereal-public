import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { promotionError, withPromotionRepository } from '@/lib/promotion-repository';
import { promotionSkuKey } from '@/data/promotion-foundation';
import { calculateBoundPromotions } from '@/data/promotion-calculation';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('pricing.read');
  if (admin instanceof NextResponse) return admin;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 }); }
  if (!Array.isArray(body) || body.length > 2000) return NextResponse.json({ error: '试算数量无效' }, { status: 400 });
  try {
    const { id } = await params;
    const result = withPromotionRepository((repository, db) => {
      const campaign = repository.get(id);
      if (!campaign.ruleDefinition) throw new Error('INVALID_PROMOTION_DEFINITION');
      const lines = body.flatMap((raw: unknown, index: number) => {
        if (!raw || typeof raw !== 'object') throw new Error('INVALID_PROMOTION_INPUT');
        const item = raw as { productId: string; variantId: string | null; quantity: number };
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 0) throw new Error('INVALID_PROMOTION_INPUT');
        const binding = campaign.products.find((entry) => promotionSkuKey(entry) === promotionSkuKey(item));
        if (!binding) throw new Error('INVALID_PROMOTION_BINDING');
        if (item.quantity === 0) return [];
        const row = db.prepare(`SELECT p.price, v.price AS variantPrice FROM Product p LEFT JOIN ProductVariant v ON v.id=? AND v.productId=p.id WHERE p.id=?`).get(binding.variantId, binding.productId) as { price: number; variantPrice: number | null };
        const price = row.variantPrice != null && row.variantPrice > 0 ? row.variantPrice : row.price;
        if (!Number.isFinite(price) || price <= 0) throw new Error('INVALID_PROMOTION_PRICE');
        return [{ id: String(index), productId: binding.productId, variantId: binding.variantId, quantity: item.quantity,
          unitPriceCents: Math.round(price * 100), basePriceCents: Math.round(price * 100) }];
      });
      const now = new Date();
      return calculateBoundPromotions(lines, [{ id: campaign.id, name: campaign.name, version: campaign.ruleVersion,
        status: 'active', startsAt: new Date(now.getTime() - 1), endsAt: new Date(now.getTime() + 60000),
        definition: campaign.ruleDefinition, bindings: campaign.products,
      }], now);
    });
    return NextResponse.json(result);
  } catch (error) {
    const failure = promotionError(error);
    if (failure.status >= 500) console.error('[promotion preview]', error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}
