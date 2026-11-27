import { expect, it } from 'vitest';
import { assertExclusivePromotionAllocations } from '@/lib/promotion-allocation-guard';
const line = (productId: string, variantId: string | null) => ({ productId, variantId, quantity: 1, discountCents: 50 });
it('accepts multiple whole qualified activities on different identities', () => {
  expect(() => assertExclusivePromotionAllocations([
    { promotionId: 'a', qualified: true, lines: [line('p1', 'v1'), line('p2', null)] },
    { promotionId: 'b', qualified: true, lines: [line('p1', 'v2')] },
  ])).not.toThrow();
});
it('rejects a SKU allocated to multiple activities, even for separate quantities', () => {
  expect(() => assertExclusivePromotionAllocations([
    { promotionId: 'a', qualified: true, lines: [line('p1', 'v1'), line('p2', null)] },
    { promotionId: 'b', qualified: true, lines: [line('p1', 'v1')] },
  ])).toThrow('PROMOTION_SKU_ALREADY_ALLOCATED');
});
it('rejects unqualified candidates and invalid allocations', () => {
  expect(() => assertExclusivePromotionAllocations([{ promotionId: 'a', qualified: false, lines: [line('p1', null)] }])).toThrow('INVALID_PROMOTION_ALLOCATION');
  expect(() => assertExclusivePromotionAllocations([{ promotionId: 'a', qualified: true, lines: [{ ...line('p1', null), quantity: 0 }] }])).toThrow('INVALID_PROMOTION_ALLOCATION');
});
