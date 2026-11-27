import { createHash } from 'node:crypto';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Remove volatile clocks while binding the revision to server pricing evidence. */
export function stablePricingEvidence(snapshot: string | null | undefined): unknown {
  if (!snapshot) return null;
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clean);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'calculatedAt' && key !== 'pricedAt')
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, entry]) => [key, clean(entry)]));
  };
  try {
    const parsed = JSON.parse(snapshot) as Record<string, unknown>;
    const rawEvidence = parsed.couponPromotionPricingEvidence as { candidates?: Array<{ bindingId?: string; promotion?: { status?: string; startsAt?: string; endsAt?: string } }> } | undefined;
    const at = typeof parsed.calculatedAt === 'string' ? Date.parse(parsed.calculatedAt) : NaN;
    const activeBindings = Number.isFinite(at) && Array.isArray(rawEvidence?.candidates)
      ? rawEvidence.candidates.filter(({ promotion }) => promotion?.status === 'active'
        && Date.parse(promotion.startsAt ?? '') <= at && Date.parse(promotion.endsAt ?? '') > at)
        .map(({ bindingId }) => bindingId).sort() : null;
    return { evidence: clean(parsed), activeBindings };
  } catch { return null; }
}

/** Hash authoritative commercial fields and stable server-side pricing evidence. */
export function buildCheckoutRevision(input: {
  items: Array<{ productId: string | null; variantId?: string | null; catalogNumber: string | null; unitPrice: number; quantity: number; pricingSnapshot?: string | null }>;
  adjustments: Array<{ type: string; amount: number }>;
  total: number;
  points?: { personalPoints: number; groupPoints: number; pointsDiscount: number } | null;
}): string {
  const revisionInput = {
    items: input.items.map(({ productId, variantId, catalogNumber, unitPrice, quantity, pricingSnapshot }) => ({
      productId, variantId: variantId ?? null, catalogNumber, unitPrice, quantity, pricingEvidence: stablePricingEvidence(pricingSnapshot),
    })),
    adjustments: input.adjustments.map(({ type, amount }) => ({ type, amount })),
    total: input.total,
    points: input.points ? {
      personalPoints: input.points.personalPoints,
      groupPoints: input.points.groupPoints,
      pointsDiscount: input.points.pointsDiscount,
    } : null,
  };
  return createHash('sha256').update(stableJson(revisionInput)).digest('hex');
}
