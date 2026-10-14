import { prisma } from '@/lib/prisma';
import { PRODUCT_LIST_SELECT } from '@/lib/prisma-selects';
import { STOREFRONT_HIDDEN_HAZARDOUS } from '@/lib/product-visibility';
import type { Product } from '@/types/Product';

export type ProductPromotionFeature = { title: string; description: string; href: string; label: string };
export type ProductPromotionCenterData = { features: ProductPromotionFeature[]; products: Product[] };

export async function getProductPromotionCenterData(): Promise<ProductPromotionCenterData> {
  const rows = await prisma.product.findMany({ where: { promotion: true, ...STOREFRONT_HIDDEN_HAZARDOUS }, select: PRODUCT_LIST_SELECT, orderBy: [{ updatedAt: 'desc' }, { category: 'asc' }, { name: 'asc' }], take: 12 });
  return { features: [], products: rows.map((row) => ({ ...row, id: row.catalogNumber, applications: safeList(row.applications), reactivity: safeList(row.reactivity), originalPrice: row.originalPrice ?? undefined, promotionalPrice: row.promotionalPrice ?? undefined })) as unknown as Product[] };
}
function safeList(value: string | null | undefined): string[] { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; } catch { return []; } }
