import { describe, expect, it } from 'vitest';
import { buyNGetMStrategy } from '@/lib/cart-promotions/strategies/buy-n-get-m';
import type { BuyNGetMRuleConfig, CartLine } from '@/lib/cart-promotions/types';

const line = (id: string, quantity: number, price: number): CartLine => ({
  id, quantity, product: { id, brand: 'Sample', catalogNumber: `SAMPLE-${id}`, price, name: `Sample ${id}` },
});

describe('generic promotion strategy', () => {
  it('applies a synthetic buy-three-get-one rule to the lowest-priced item', () => {
    const rule: BuyNGetMRuleConfig = { id: 'sample-rule', type: 'buy-n-get-m', name: 'Sample', enabled: true, description: 'Synthetic fixture.', groupSize: 3, freeCount: 1, brand: 'Sample', terms: ['SAMPLE-'] };
    const result = buyNGetMStrategy.evaluate(rule, { items: [line('a', 1, 100), line('b', 1, 80), line('c', 1, 60)], rules: [rule], now: new Date() });
    expect(result.details?.discountTotal).toBe(60);
  });
});
