import type Database from 'better-sqlite3';
import { promotionSkuKey, type PromotionSkuBinding } from '@/data/promotion-foundation';
import { catalogReferenceCents } from '@/lib/promotion-catalog-pricing';

/** These selectors are inputs to publication. The resolved bindings contain no wildcard. */
export type PromotionSelection =
  | { productId: string; variantId: string | null; groupKey: string }
  | { productId: string; allVariants: true; groupKey: string };
export type FrozenPromotionSelection = PromotionSkuBinding & { referenceCents: number };

/** Expand draft selectors without requiring prices; publication performs stricter validation. */
export function resolvePromotionSelection(db: Database.Database, selections: PromotionSelection[]): PromotionSkuBinding[] {
  if (!Array.isArray(selections) || selections.length === 0 || selections.length > 2000) throw new Error('INVALID_PROMOTION_SELECTION');
  const result: PromotionSkuBinding[] = [];
  const seen = new Set<string>();
  const append = (binding: PromotionSkuBinding) => {
    const key = promotionSkuKey(binding);
    if (seen.has(key)) throw new Error('DUPLICATE_PROMOTION_SKU');
    if (result.length >= 2000) throw new Error('INVALID_PROMOTION_SELECTION');
    seen.add(key); result.push(binding);
  };
  for (const selection of selections) {
    if (!selection || typeof selection.productId !== 'string' || !selection.productId.trim()
      || typeof selection.groupKey !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(selection.groupKey)) throw new Error('INVALID_PROMOTION_SELECTION');
    const product = db.prepare('SELECT id, hazardous, deletedAt FROM Product WHERE id = ?').get(selection.productId) as
      { id: string; hazardous: number; deletedAt: string | null } | undefined;
    if (!product || product.hazardous || product.deletedAt) throw new Error('INVALID_PROMOTION_PRODUCT');
    if ('allVariants' in selection) {
      if (selection.allVariants !== true || 'variantId' in selection) throw new Error('INVALID_PROMOTION_SELECTION');
      const variants = db.prepare('SELECT id FROM ProductVariant WHERE productId = ? ORDER BY id LIMIT ?')
        .all(product.id, 2001 - result.length) as Array<{ id: string }>;
      if (!variants.length) throw new Error('INVALID_PROMOTION_SELECTION');
      for (const variant of variants) append({ productId: product.id, variantId: variant.id, groupKey: selection.groupKey });
    } else {
      if (selection.variantId !== null && (typeof selection.variantId !== 'string' || !selection.variantId.trim()
        || !db.prepare('SELECT id FROM ProductVariant WHERE id = ? AND productId = ?').get(selection.variantId, product.id))) throw new Error('INVALID_PROMOTION_VARIANT');
      append({ productId: product.id, variantId: selection.variantId, groupKey: selection.groupKey });
    }
  }
  return result;
}

/**
 * Resolve all-variant selectors from the database in the caller's publication transaction.
 * The returned explicit identities are the publication snapshot; later variants are not included.
 * A variant never inherits the parent product's reference price.
 */
export function freezeCatalogPromotionSelection(db: Database.Database, selections: PromotionSelection[]): FrozenPromotionSelection[] {
  if (!Array.isArray(selections) || selections.length === 0 || selections.length > 2000) throw new Error('INVALID_PROMOTION_SELECTION');
  const result: FrozenPromotionSelection[] = [];
  const seen = new Set<string>();
  const append = (productId: string, variantId: string | null, groupKey: string, price: unknown) => {
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) throw new Error('PROMOTION_CATALOG_PRICE_REQUIRED');
    // Reject references that round to zero cents or exceed the safe range,
    // matching the pricing conversion instead of freezing unusable values.
    const referenceCents = catalogReferenceCents({ productId, productOriginalPrice: price, variant: variantId
      ? { id: variantId, productId, originalPrice: price } : null });
    const binding = { productId, variantId, groupKey };
    const key = promotionSkuKey(binding);
    if (seen.has(key)) throw new Error('DUPLICATE_PROMOTION_SKU');
    if (result.length >= 2000) throw new Error('INVALID_PROMOTION_SELECTION');
    seen.add(key); result.push({ ...binding, referenceCents });
  };
  for (const selection of selections) {
    if (!selection || typeof selection.productId !== 'string' || !selection.productId.trim()
      || typeof selection.groupKey !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(selection.groupKey)) throw new Error('INVALID_PROMOTION_SELECTION');
    const product = db.prepare('SELECT id,originalPrice,hazardous,deletedAt FROM Product WHERE id = ?').get(selection.productId) as
      { id: string; originalPrice: number | null; hazardous: number; deletedAt: string | null } | undefined;
    if (!product || product.hazardous || product.deletedAt) throw new Error('INVALID_PROMOTION_PRODUCT');
    if ('allVariants' in selection) {
      if (selection.allVariants !== true || 'variantId' in selection) throw new Error('INVALID_PROMOTION_SELECTION');
      const variants = db.prepare('SELECT id,originalPrice FROM ProductVariant WHERE productId = ? ORDER BY id LIMIT ?')
        .all(product.id, 2001 - result.length) as Array<{ id: string; originalPrice: number | null }>;
      if (variants.length === 0) throw new Error('INVALID_PROMOTION_SELECTION');
      for (const variant of variants) append(product.id, variant.id, selection.groupKey, variant.originalPrice);
    } else if (selection.variantId === null) {
      append(product.id, null, selection.groupKey, product.originalPrice);
    } else {
      if (typeof selection.variantId !== 'string' || !selection.variantId.trim()) throw new Error('INVALID_PROMOTION_SELECTION');
      const variant = db.prepare('SELECT id,originalPrice FROM ProductVariant WHERE id = ? AND productId = ?').get(selection.variantId, product.id) as { id: string; originalPrice: number | null } | undefined;
      if (!variant) throw new Error('INVALID_PROMOTION_VARIANT');
      append(product.id, variant.id, selection.groupKey, variant.originalPrice);
    }
  }
  return result;
}
