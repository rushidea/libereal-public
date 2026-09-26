import { prisma } from '@/lib/prisma';
import {
  buildProductClassifyIndex,
  classifyProduct,
  type ProductClassifyExample,
  type ProductClassifyIndex,
  type ProductClassifyInput,
  type ProductClassifyResult,
} from '@/data/product-smart-classify';

const EXAMPLE_SELECT = {
  name: true,
  brand: true,
  category: true,
  subcategory: true,
  type: true,
} as const;

export async function loadProductClassifyIndex(options?: {
  brand?: string;
}): Promise<ProductClassifyIndex> {
  const examples = await prisma.product.findMany({
    where: {
      category: { not: null },
      ...(options?.brand ? { brand: options.brand } : {}),
    },
    select: EXAMPLE_SELECT,
  });
  return buildProductClassifyIndex(examples as ProductClassifyExample[]);
}

export async function classifyCatalogProduct(
  input: ProductClassifyInput,
  index?: ProductClassifyIndex,
): Promise<ProductClassifyResult> {
  const resolved = index ?? await loadProductClassifyIndex(input.brand ? { brand: input.brand } : undefined);
  return classifyProduct(input, { index: resolved });
}

export const MAX_CLASSIFY_PREVIEW = 200;

export type CatalogClassifySuggestion = {
  catalogNumber: string;
  spec: string;
  ok: boolean;
  category: string | null;
  subcategory: string | null;
  type: string | null;
};

export async function classifyMissingCatalogPreview(input: {
  brand: string;
  items: Array<{ name: string; catalogNumber: string; spec?: string }>;
}): Promise<CatalogClassifySuggestion[]> {
  const items = input.items.slice(0, MAX_CLASSIFY_PREVIEW);
  const index = await loadProductClassifyIndex();
  return items.map((item) => {
    const result = classifyProduct({
      name: item.name,
      brand: input.brand,
      catalogNumber: item.catalogNumber,
      spec: item.spec,
    }, { index });
    if (!result.ok) {
      return {
        catalogNumber: item.catalogNumber,
        spec: item.spec ?? '',
        ok: false,
        category: null,
        subcategory: null,
        type: null,
      };
    }
    return {
      catalogNumber: item.catalogNumber,
      spec: item.spec ?? '',
      ok: true,
      category: result.category,
      subcategory: result.subcategory,
      type: result.type,
    };
  });
}
