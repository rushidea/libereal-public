import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/discount', () => ({
  // Synthetic approval fixture only. No merchant policy is bundled into Public.
  CONFIRMED_TIER_DISCOUNT_RATES: { 'fixture-tier': 0.75, 'fixture-full': 1 },
  TIER_DISCOUNT_RATES: {},
}));
import { calculatePrice } from '@/lib/price-engine';

describe('configured customer tier priority', () => {
  const base = { basePrice: 100, discountPolicy: 'brand_priority' as const, brandDefaultDiscountRate: 0.6 };
  it('uses an explicit configured tier instead of taking the lowest default', () => {
    expect(calculatePrice({ ...base, tier: 'fixture-tier' })).toMatchObject({ finalPrice: 75, appliedSource: 'tier:fixture-tier' });
    expect(calculatePrice({ ...base, tier: 'fixture-full' })).toMatchObject({ finalPrice: 100, appliedSource: 'tier:fixture-full' });
    expect(calculatePrice({ ...base, tier: 'unknown' })).toMatchObject({ finalPrice: 60, appliedSource: 'brand_default_discount' });
  });
  it('still gives the customer brand agreement priority over a configured tier', () => {
    expect(calculatePrice({ ...base, tier: 'fixture-tier', brandDiscountRate: 0.9 })).toMatchObject({ finalPrice: 90, appliedSource: 'customer_brand_discount' });
    expect(calculatePrice({ ...base, tier: 'fixture-tier', brandDiscountRate: 1 })).toMatchObject({ finalPrice: 100, appliedSource: 'customer_brand_discount' });
  });
});
