import type { Product, ProductVariant } from '@/types/Product';

function normalizeSpec(spec: string | null | undefined): string {
  return (spec || '').trim().toLocaleLowerCase();
}

function optionKey(spec: string | null | undefined, price: number): string {
  return `${normalizeSpec(spec)}|${price}`;
}

type PackageVariantInput = {
  id?: string;
  catalogNumber: string;
  spec?: string | null;
  price: number;
  salesUnit?: string | null;
  stockQuantity?: number | null;
  leadTime?: string | null;
  inStock?: boolean;
};

/**
 * 将商品本体与 ProductVariant 包装规格合并为前台可选规格。
 * 本体规格若与某包装重复则保留包装行（带 variantId，便于计价）；
 * 本体有独立规格/价格时（例如单瓶与整箱规格）一并保留。
 * 合并后不足 2 项时返回空数组，表示不需要规格选择。
 */
export function mergeProductPackageOptions(
  product: Pick<Product, 'catalogNumber' | 'price'> & { spec?: string | null },
  packageVariants: readonly PackageVariantInput[],
): ProductVariant[] {
  if (packageVariants.length === 0) return [];

  const covered = new Set(
    packageVariants.map((variant) => optionKey(variant.spec, variant.price)),
  );
  const basePrice = product.price ?? 0;
  const baseSpec = product.spec?.trim() || '';
  const options: ProductVariant[] = [];

  if (baseSpec && basePrice > 0 && !covered.has(optionKey(baseSpec, basePrice))) {
    options.push({
      catalogNumber: product.catalogNumber,
      spec: baseSpec,
      price: basePrice,
    });
  }

  for (const variant of packageVariants) {
    options.push({
      id: variant.id,
      catalogNumber: variant.catalogNumber,
      spec: variant.spec?.trim() || '标准规格',
      price: variant.price,
      salesUnit: variant.salesUnit ?? undefined,
      stockQuantity: variant.stockQuantity ?? undefined,
      leadTime: variant.leadTime ?? undefined,
      inStock: variant.inStock,
    });
  }
  return options.length > 1 ? options : [];
}

const SIZE_SUFFIX_LABELS: Record<string, string> = {
  T: '试验装',
  S: '标准装',
  L: '大包装',
  A: '50μl / 25T',
  B: '100μl / 100T',
  C: '200μl / 大包装',
  D: '500μl',
};

/**
 * 规格按钮文案：标题优先用规格；若规格与后缀标签不同则附副标题，避免「500mL / 500mL」重复。
 */
export function getVariantOptionCopy(
  variant: Pick<Product, 'catalogNumber'> & { spec?: string | null },
): { title: string; subtitle?: string } {
  const spec = variant.spec?.trim() || '';
  const suffix = variant.catalogNumber.slice(-1);
  const suffixLabel = SIZE_SUFFIX_LABELS[suffix];

  if (spec) {
    if (suffixLabel && suffixLabel !== spec) {
      return { title: spec, subtitle: suffixLabel };
    }
    return { title: spec };
  }

  return { title: suffixLabel || suffix || '标准规格' };
}
