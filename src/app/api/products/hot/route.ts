import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { PRODUCT_LIST_SELECT } from '@/lib/prisma-selects';
import { STOREFRONT_HIDDEN_HAZARDOUS } from '@/lib/product-visibility';
import {
  HOT_PRODUCT_TEST_BRANDS,
  HOT_PRODUCT_TEST_IDENTIFIERS,
  HOT_PRODUCT_TEST_NAMES,
  isHotProductEligible,
} from '@/lib/hot-products';
import { attachDisplayPrices, resolveIsFormalMember } from '@/lib/product-display';

type ProductListRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_LIST_SELECT }>;

const HOT_PRODUCT_EXCLUSIONS: Prisma.ProductWhereInput = {
  NOT: [
    { id: { in: [...HOT_PRODUCT_TEST_IDENTIFIERS] } },
    { catalogNumber: { in: [...HOT_PRODUCT_TEST_IDENTIFIERS] } },
    { name: { in: [...HOT_PRODUCT_TEST_NAMES] } },
    { brand: { in: [...HOT_PRODUCT_TEST_BRANDS] } },
  ],
};



function parseProduct(product: ProductListRow) {
  return {
    ...product,
    id: product.catalogNumber,
    applications: JSON.parse(product.applications),
    reactivity: JSON.parse(product.reactivity),
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '4', 10) || 4, 1), 12);

  try {


    const catalogCandidates = await prisma.product.findMany({
      where: {
        ...HOT_PRODUCT_EXCLUSIONS,
      },
      select: PRODUCT_LIST_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: limit * 3,
    });

    const pool = catalogCandidates.filter(isHotProductEligible);
    // Fisher-Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const rankedProducts = pool.slice(0, limit);

    let finalProducts = rankedProducts;

    if (finalProducts.length < limit) {
      const usedIds = new Set(finalProducts.map((product) => product.id));
      const fallback = await prisma.product.findMany({
        where: {
          id: { notIn: [...usedIds] },
          ...STOREFRONT_HIDDEN_HAZARDOUS,
          ...HOT_PRODUCT_EXCLUSIONS,
        },
        select: PRODUCT_LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        take: limit - finalProducts.length,
      });
      finalProducts = [...finalProducts, ...fallback.filter(isHotProductEligible)];
    }

    const isFormalMember = await resolveIsFormalMember();

    return NextResponse.json({
      // 方案③：服务端按请求者状态算展示价，剥离 price/originalPrice/promotionalPrice
      products: attachDisplayPrices(finalProducts.map((product) => parseProduct(product)), isFormalMember),
    });
  } catch (err) {
    console.error('[products/hot GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
