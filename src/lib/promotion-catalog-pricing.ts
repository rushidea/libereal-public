/** Trusted catalog reference inputs. A variant never inherits its product's price. */
export type CatalogReference = {
  productId: string;
  productOriginalPrice: number | null;
  variant: { id: string; productId: string; originalPrice: number | null } | null;
};

/** Resolve one product/variant reference as integer cents; no client price is accepted. */
export function catalogReferenceCents(reference: CatalogReference): number {
  if (!reference.productId || (reference.variant && (!reference.variant.id || reference.variant.productId !== reference.productId))) {
    throw new Error('INVALID_PROMOTION_VARIANT');
  }
  const value = reference.variant ? reference.variant.originalPrice : reference.productOriginalPrice;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('PROMOTION_CATALOG_PRICE_REQUIRED');
  // Convert the canonical decimal representation, not the binary float product,
  // so values such as 10.075 round to 1008 cents consistently.
  const [coefficient, exponentText] = value.toString().toLowerCase().split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = BigInt(whole + fraction);
  const power = Number(exponentText ?? 0) - fraction.length + 2;
  let cents: bigint;
  if (power >= 0) cents = digits * BigInt(10) ** BigInt(power);
  else {
    const divisor = BigInt(10) ** BigInt(-power);
    cents = (digits + divisor / BigInt(2)) / divisor;
  }
  if (cents <= BigInt(0) || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('PROMOTION_CATALOG_PRICE_REQUIRED');
  return Number(cents);
}

/** Apply exactly one catalog percentage, in basis points, using half-up cent rounding. */
export function catalogPercentageCents(referenceCents: number, basisPoints: number): number {
  if (!Number.isSafeInteger(referenceCents) || referenceCents <= 0
    || !Number.isSafeInteger(basisPoints) || basisPoints <= 0 || basisPoints > 10000
    || referenceCents > Math.floor(Number.MAX_SAFE_INTEGER / basisPoints)) throw new Error('INVALID_PROMOTION_AMOUNT');
  const cents = Math.round(referenceCents * basisPoints / 10000);
  if (cents <= 0) throw new Error('PROMOTION_CATALOG_PRICE_REQUIRED');
  return cents;
}
