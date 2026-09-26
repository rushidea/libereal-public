import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CART_ADDON_RULES } from '@/lib/cart-promotions/rules';
import { isRuleActive } from '@/lib/cart-promotions/detect';
import { attachDisplayPrices, resolveIsFormalMember } from '@/lib/product-display';

export const dynamic = 'force-dynamic';

/** 返回某换购规则的可换购产品清单（在售、有价、非危化）。 */
export async function GET(req: NextRequest) {
  const ruleId = req.nextUrl.searchParams.get('ruleId');
  const rule = CART_ADDON_RULES.find((r) => r.id === ruleId);
  if (!rule || !isRuleActive(rule)) {
    return NextResponse.json({ error: 'RULE_NOT_FOUND' }, { status: 404 });
  }

  const products = await prisma.product.findMany({
    where: {
      AND: [
        { OR: rule.addonTerms.map((term) => ({ catalogNumber: { startsWith: term } })) },
        ...(rule.addonBrand ? [{ brand: rule.addonBrand }] : []),
        { inStock: true },
        { pricingMode: 'fixed' },
        { hazardous: false },
        { price: { gt: 0 } },
      ],
    },
    select: {
      id: true,
      catalogNumber: true,
      brand: true,
      name: true,
      spec: true,
      salesUnit: true,
      price: true,
      originalPrice: true,
      imageUrl: true,
      inStock: true,
      stockQuantity: true,
      leadTime: true,
    },
    orderBy: { catalogNumber: 'asc' },
    take: 60,
  });

  // 方案③：按请求者状态算展示价并剥离原始价
  const isFormalMember = await resolveIsFormalMember();

  return NextResponse.json({
    ruleId: rule.id,
    addonPrice: rule.addonPrice,
    products: attachDisplayPrices(products, isFormalMember),
  });
}
