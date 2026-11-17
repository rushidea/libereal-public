import { describe, expect, it } from 'vitest';
import { calculatePrice } from '@/lib/price-engine';

describe('price engine', () => {
  it('uses the brand default only after customer and tier rates, without stacking or taking the lowest price', () => {
    const base = { basePrice: 100, discountPolicy: 'brand_priority' as const, brandDefaultDiscountRate: 0.6,
      minimumSalePrice: 95, promotions: [{ id: 'unapproved', name: 'legacy promotion', type: 'fixed_price' as const, value: 20, priority: 1, exclusive: true }] };
    expect(calculatePrice({ ...base, brandDiscountRate: 0.9, tier: 'tier-2' })).toMatchObject({ finalPrice: 90, appliedSource: 'customer_brand_discount', minimumPriceApplied: false });
    // Public tier placeholders are not approved merchant discounts.
    expect(calculatePrice({ ...base, tier: 'tier-2' })).toMatchObject({ finalPrice: 60, appliedSource: 'brand_default_discount' });
    expect(calculatePrice({ ...base, tier: 'standard' })).toMatchObject({ finalPrice: 60, appliedSource: 'brand_default_discount' });
    expect(calculatePrice({ ...base, brandDiscountRate: 1 })).toMatchObject({ finalPrice: 100, appliedSource: 'customer_brand_discount' });
  });
  it('does not invent a default or turn a legacy customer scalar into a brand policy', () => {
    expect(() => calculatePrice({ basePrice: 100, discountPolicy: 'brand_priority' })).toThrow('BRAND_DEFAULT_DISCOUNT_REQUIRED');
    expect(() => calculatePrice({ basePrice: 100, discountPolicy: 'brand_priority', brandDefaultDiscountRate: 0.8, personalDiscountRate: 0.5 })).toThrow('LEGACY_CUSTOMER_DISCOUNT_REVIEW_REQUIRED');
    expect(calculatePrice({ basePrice: 100, discountPolicy: 'brand_priority', brandDefaultDiscountRate: 0.8, personalDiscountRate: 0.5, brandDiscountRate: 0.9 }).finalPrice).toBe(90);
  });
  it('uses variant price before discounts', () => {
    const result = calculatePrice({ basePrice: 1000, variantPrice: 800, tier: 'standard', personalDiscountRate: 0.995 });
    expect(result.finalPrice).toBe(796);
    expect(result.steps.find((step) => step.stage === 'variant')?.applied).toBe(true);
  });

  it('uses brand discount instead of stacking with tier discount', () => {
    const result = calculatePrice({ basePrice: 1000, tier: 'tier-8', brandDiscountRate: 0.8 });
    expect(result.finalPrice).toBe(800);
    expect(result.steps.find((step) => step.stage === 'brand_discount')?.reason).toContain('互斥');
  });

  it('rounds a 0.55 price multiplier to the nearest cent', () => {
    const result = calculatePrice({
      basePrice: 1.01,
      promotions: [{ id: 'synthetic-promotion', name: 'Synthetic rate promotion', type: 'discount_rate', value: 0.55, priority: 1, exclusive: true }],
    });
    expect(result.finalPrice).toBe(0.56);
    expect(result.appliedSource).toBe('promotion:synthetic-promotion');
  });

  it('selects the lowest valid promotion or user price', () => {
    const result = calculatePrice({
      basePrice: 1000,
      tier: 'standard',
      promotions: [
        { id: 'p1', name: '九折', type: 'discount_rate', value: 0.9, priority: 1, exclusive: true },
        { id: 'p2', name: '活动价', type: 'fixed_price', value: 850, priority: 1, exclusive: true },
      ],
    });
    expect(result.finalPrice).toBe(850);
    expect(result.appliedSource).toBe('promotion:p2');
  });

  it('applies manual adjustment last and enforces minimum price', () => {
    const result = calculatePrice({
      basePrice: 1000,
      manualAdjustment: { type: 'amount_off', value: 400, reason: '人工优惠' },
      minimumSalePrice: 700,
    });
    expect(result.finalPrice).toBe(700);
    expect(result.minimumPriceApplied).toBe(true);
  });

  it('rejects invalid discount rates', () => {
    expect(() => calculatePrice({ basePrice: 100, manualAdjustment: { type: 'discount_rate', value: 1.2 } }))
      .toThrow('INVALID_DISCOUNT_RATE');
  });
});
