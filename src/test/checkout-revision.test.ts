import { describe, expect, it } from 'vitest';
import { buildCheckoutRevision } from '@/lib/checkout-revision';

describe('checkout revision', () => {
  it('ignores volatile pricing snapshots', () => {
    const input = {
      items: [{ productId: 'SYNTH-PRODUCT', catalogNumber: 'SYNTH-CAT', unitPrice: 100, quantity: 2 }],
      adjustments: [{ type: 'promotion_addon', amount: -10 }],
      total: 190,
      points: { personalPoints: 0, groupPoints: 0, pointsDiscount: 0 },
    };
    expect(buildCheckoutRevision({ ...input, items: [{ ...input.items[0], pricingSnapshot: 'old' }] }))
      .toBe(buildCheckoutRevision({ ...input, items: [{ ...input.items[0], pricingSnapshot: 'new' }] }));
  });
  it('binds variants and stable pricing evidence while ignoring calculation clocks', () => {
    const item = { productId: 'p', variantId: 'v1', catalogNumber: 'SKU', unitPrice: 100, quantity: 1 };
    const input = { adjustments: [], total: 100 };
    const revision = (variantId: string, source: string, calculatedAt: string) => buildCheckoutRevision({ ...input,
      items: [{ ...item, variantId, pricingSnapshot: JSON.stringify({ calculatedAt, appliedSource: source }) }] });
    expect(revision('v1', 'promotion:a', '2030-01-01')).toBe(revision('v1', 'promotion:a', '2030-01-02'));
    expect(revision('v1', 'promotion:a', '2030-01-01')).not.toBe(revision('v2', 'promotion:a', '2030-01-01'));
    expect(revision('v1', 'promotion:a', '2030-01-01')).not.toBe(revision('v1', 'promotion:b', '2030-01-01'));
  });
  it('changes when a candidate crosses its activity time boundary even at the same price', () => {
    const item = { productId: 'p', variantId: null, catalogNumber: 'SKU', unitPrice: 100, quantity: 1 };
    const candidate = { bindingId: 'binding', promotion: { status: 'active', startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-02T00:00:00Z' } };
    const revision = (calculatedAt: string) => buildCheckoutRevision({ adjustments: [], total: 100,
      items: [{ ...item, pricingSnapshot: JSON.stringify({ calculatedAt, couponPromotionPricingEvidence: { candidates: [candidate] } }) }] });
    expect(revision('2029-12-31T23:59:59Z')).not.toBe(revision('2030-01-01T00:00:00Z'));
    expect(revision('2030-01-01T00:00:00Z')).not.toBe(revision('2030-01-02T00:00:00Z'));
  });
});
