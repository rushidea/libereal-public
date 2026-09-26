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
});
