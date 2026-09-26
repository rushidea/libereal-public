import { createHash } from 'node:crypto';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Hash only authoritative commercial fields; pricing snapshots are volatile metadata. */
export function buildCheckoutRevision(input: {
  items: Array<{ productId: string | null; catalogNumber: string | null; unitPrice: number; quantity: number; pricingSnapshot?: string | null }>;
  adjustments: Array<{ type: string; amount: number }>;
  total: number;
  points?: { personalPoints: number; groupPoints: number; pointsDiscount: number } | null;
}): string {
  const revisionInput = {
    items: input.items.map(({ productId, catalogNumber, unitPrice, quantity }) => ({ productId, catalogNumber, unitPrice, quantity })),
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
