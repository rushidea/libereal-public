/** Fully evaluated candidates are inputs; this function does not select a winner. */
export type QualifiedPromotionAllocation = {
  promotionId: string;
  qualified: boolean;
  lines: Array<{ productId: string; variantId: string | null; quantity: number; discountCents: number }>;
};

/** Reject shared identities; the caller must separately prove qualification and whole-candidate allocation. */
export function assertExclusivePromotionAllocations(selected: QualifiedPromotionAllocation[]): void {
  const promotions = new Set<string>();
  const owners = new Map<string, string>();
  for (const candidate of selected) {
    if (!candidate.promotionId || !candidate.qualified || promotions.has(candidate.promotionId) || !candidate.lines.length) {
      throw new Error('INVALID_PROMOTION_ALLOCATION');
    }
    promotions.add(candidate.promotionId);
    for (const line of candidate.lines) {
      if (!line.productId || (line.variantId !== null && !line.variantId)
        || !Number.isSafeInteger(line.quantity) || line.quantity <= 0
        || !Number.isSafeInteger(line.discountCents) || line.discountCents < 0) throw new Error('INVALID_PROMOTION_ALLOCATION');
      const key = JSON.stringify([line.productId, line.variantId]);
      const previous = owners.get(key);
      if (previous && previous !== candidate.promotionId) throw new Error('PROMOTION_SKU_ALREADY_ALLOCATED');
      owners.set(key, candidate.promotionId);
    }
  }
}
