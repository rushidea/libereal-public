import type { Product } from '@/types/Product';
import { getDisplayBrand } from '@/lib/productImage';

export type ProductSubcategoryGroup = {
  title: string;
  eyebrow?: string;
  products: Product[];
};

/** Group products by subcategory for list-view sections. */
export function groupProductsForListView(
  products: Product[],
  fallbackTitle = '产品列表',
): ProductSubcategoryGroup[] {
  const buckets = new Map<string, Product[]>();

  for (const product of products) {
    const key = product.subcategory?.trim() || fallbackTitle;
    const list = buckets.get(key) ?? [];
    list.push(product);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([title, items]) => ({
      title,
      eyebrow: resolveGroupEyebrow(items),
      products: items,
    }));
}

function resolveGroupEyebrow(products: Product[]): string | undefined {
  const sample = products[0];
  if (!sample) return undefined;
  const brand = getDisplayBrand(sample);
  return brand || sample.brand || undefined;
}
