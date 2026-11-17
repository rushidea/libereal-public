import { createHash } from 'crypto';
import type { PriceAdjustmentRequest } from '@/lib/pricing-adjustment-rules';

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Bind confirmation to the complete preview, not just its query or first page. */
export function priceAdjustmentApprovalHash(request: PriceAdjustmentRequest, plan: unknown): string {
  const content = Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'stepUpToken' && key !== 'approvalHash'));
  return pricingContentHash({ version: 1, request: content, plan });
}

export function pricingContentHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function isPriceAdjustmentApprovalHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
