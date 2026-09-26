import { NextRequest, NextResponse } from 'next/server';
import { ProductSearchService, productSearchParamsFromUrl } from '@/lib/product-search';
import { resolveIsFormalMember, sanitizeProductsWithVariants } from '@/lib/product-display';

export async function GET(req: NextRequest) {
  try {
    const params = productSearchParamsFromUrl(new URL(req.url).searchParams);
    const [result, isFormalMember] = await Promise.all([
      ProductSearchService.search(params),
      resolveIsFormalMember(),
    ]);
    // 方案③：缓存内是无用户态原始数据，这里按请求者状态算展示价并剥离原始价（含变体）
    const products = sanitizeProductsWithVariants(result.products, isFormalMember);
    return NextResponse.json({ ...result, products });
  } catch (error) {
    console.error('[products GET] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
