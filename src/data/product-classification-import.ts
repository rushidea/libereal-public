import { classifyProduct, type ProductClassifyHit } from '@/data/product-smart-classify';

export type ProductImportVariant = {
  catalogNumber: string;
  spec: string;
  price: number;
  originalPrice: number;
};

export type ProductImportJob = {
  productData: {
    catalogNumber: string;
    name: string;
    brand: string;
    price: number;
    originalPrice?: number;
    category: string;
    subcategory: string;
    type: string | null;
    spec: string;
    inStock: boolean;
    imageUrl: string | null;
  };
  variants: ProductImportVariant[];
};

export function normalizeImportCell(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

export function parseImportPrice(value: unknown): number {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function classifyImportRow(row: readonly unknown[]): ProductImportJob | null {
  const brand = normalizeImportCell(row[0]);
  const name = normalizeImportCell(row[1]);
  const catalogNumber = normalizeImportCell(row[2]);
  if (!brand || !catalogNumber || !name) return null;

  const spec1 = normalizeImportCell(row[6]);
  const classification = classifyProduct({ name, brand, catalogNumber, spec: spec1 });
  // Unsupported input is skipped. In particular, never fall back to a broad
  // antibody category when the shared classifier has no supported result.
  if (!classification.ok) return null;

  const variants: ProductImportVariant[] = [];
  for (const [specIndex, priceIndex] of [[8, 9], [10, 11], [12, 13]] as const) {
    const spec = normalizeImportCell(row[specIndex]);
    const price = parseImportPrice(row[priceIndex]);
    if (spec && price > 0) variants.push({ catalogNumber, spec, price, originalPrice: price });
  }

  return {
    productData: {
      catalogNumber,
      name,
      brand,
      price: parseImportPrice(row[7]),
      originalPrice: undefined,
      category: classification.category,
      subcategory: classification.subcategory,
      type: classification.type,
      spec: spec1,
      inStock: row[15] === 99,
      imageUrl: normalizeImportCell(row[17]) || null,
    },
    variants,
  };
}

export function completePlacement(hit: ProductClassifyHit): {
  category: string;
  subcategory: string;
  type: string | null;
} {
  // A classifier result owns the full placement. Clearing type here prevents
  // stale L3 values from surviving a new category/subcategory assignment.
  return { category: hit.category, subcategory: hit.subcategory, type: hit.type ?? null };
}
