import { prisma } from '@/lib/prisma';
import {
  resolveCatalogUnitPrice,
  reviewCommerceLines,
  type CommerceLineInput,
  type CommerceLineReview,
} from '@/lib/commerce-line-review';

export type CommerceLineRef = {
  lineId?: string | null;
  index?: number;
  productId?: string | null;
  variantId?: string | null;
  name?: string | null;
  spec?: string | null;
  catalogNumber?: string | null;
  unitPrice: unknown;
  quantity: unknown;
};

type ProductPriceRow = {
  id: string;
  price: number;
  originalPrice: number | null;
  category: string | null;
  subcategory: string | null;
  type: string | null;
  spec: string | null;
  name: string;
};

type VariantPriceRow = {
  id: string;
  productId: string;
  price: number;
  originalPrice: number | null;
  spec: string;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readVariantId(item: Record<string, unknown>): string | null {
  const direct = text(item.variantId);
  if (direct) return direct;
  if (typeof item.metadata !== 'string' || !item.metadata.trim()) return null;
  try {
    const parsed = JSON.parse(item.metadata) as Record<string, unknown>;
    return text(parsed.variantId);
  } catch {
    return null;
  }
}

function readMetadataText(item: Record<string, unknown>, key: string): string | null {
  if (typeof item.metadata !== 'string' || !item.metadata.trim()) return null;
  try {
    const parsed = JSON.parse(item.metadata) as Record<string, unknown>;
    return text(parsed[key]);
  } catch {
    return null;
  }
}

export function commerceLineRefFromRecord(item: Record<string, unknown>, index: number): CommerceLineRef {
  return {
    index,
    lineId: text(item.id),
    productId: text(item.productId),
    variantId: readVariantId(item),
    name: text(item.name),
    spec: text(item.spec) ?? readMetadataText(item, 'spec'),
    catalogNumber: text(item.catalogNumber),
    unitPrice: item.price !== undefined ? item.price : item.unitPrice,
    quantity: item.quantity,
  };
}

export async function reviewCommerceLinesWithCatalog(lines: CommerceLineRef[]): Promise<CommerceLineReview> {
  const productIds = unique(lines.map((line) => line.productId));
  const variantIds = unique(lines.map((line) => line.variantId));
  const variants = variantIds.length
    ? await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true, productId: true, price: true, originalPrice: true, spec: true },
    })
    : [];
  const variantProductIds = variants.map((variant) => variant.productId);
  const products = unique([...productIds, ...variantProductIds]).length
    ? await prisma.product.findMany({
      where: { id: { in: unique([...productIds, ...variantProductIds]) } },
      select: { id: true, price: true, originalPrice: true, category: true, subcategory: true, type: true, spec: true, name: true },
    })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));

  const inputs: CommerceLineInput[] = lines.map((line, index) => {
    const variant: VariantPriceRow | undefined = line.variantId ? variantById.get(line.variantId) : undefined;
    const product: ProductPriceRow | undefined = productById.get(variant?.productId || line.productId || '');
    return {
      index: line.index ?? index,
      lineId: line.lineId,
      name: line.name || product?.name || null,
      spec: line.spec || variant?.spec || product?.spec || null,
      catalogNumber: line.catalogNumber,
      category: product?.category ?? null,
      subcategory: product?.subcategory ?? null,
      type: product?.type ?? null,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      catalogPrice: resolveCatalogUnitPrice({
        variantPrice: variant?.price,
        variantOriginalPrice: variant?.originalPrice,
        productPrice: product?.price,
        productOriginalPrice: product?.originalPrice,
      }),
    };
  });
  return reviewCommerceLines(inputs);
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}
