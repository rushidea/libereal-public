import { prisma } from '@/lib/prisma';
import type { QuoteProductTaxonomy } from '@/lib/quote-records';

const PRODUCT_ID_CHUNK = 400;

/** 按报价行上的 productId 读取商品分类。查不到的商品不在结果里。 */
export async function loadQuoteProductTaxonomy(
  productIds: Iterable<string | null | undefined>,
): Promise<Map<string, QuoteProductTaxonomy>> {
  const ids = [...new Set(Array.from(productIds).filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const taxonomy = new Map<string, QuoteProductTaxonomy>();
  for (let offset = 0; offset < ids.length; offset += PRODUCT_ID_CHUNK) {
    const products = await prisma.product.findMany({
      where: { id: { in: ids.slice(offset, offset + PRODUCT_ID_CHUNK) } },
      select: { id: true, category: true, subcategory: true, type: true },
    });
    for (const product of products) {
      taxonomy.set(product.id, {
        category: product.category,
        subcategory: product.subcategory,
        type: product.type,
      });
    }
  }
  return taxonomy;
}
