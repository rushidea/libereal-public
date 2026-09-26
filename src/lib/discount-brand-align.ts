import {
  alignBrandDiscounts,
  loadCatalogBrandKeys,
  parseBrandDiscountsJson,
  serializeBrandDiscounts,
  type AlignBrandDiscountsResult,
} from '@/lib/discount-brand-catalog';
import type { PrismaClient } from '@prisma/client';

export async function alignBrandDiscountsPayload(
  db: Pick<PrismaClient, 'product'>,
  brandDiscounts: unknown,
): Promise<{ serialized: string | null; result: AlignBrandDiscountsResult }> {
  const parsed = parseBrandDiscountsJson(brandDiscounts);
  if (!parsed || Object.keys(parsed).length === 0) {
    return {
      serialized: null,
      result: { aligned: {}, unmapped: [], renames: [] },
    };
  }
  const catalogKeys = await loadCatalogBrandKeys(db);
  const result = alignBrandDiscounts(parsed, catalogKeys);
  const serialized = Object.keys(result.aligned).length > 0
    ? serializeBrandDiscounts(result.aligned)
    : null;
  return { serialized, result };
}
