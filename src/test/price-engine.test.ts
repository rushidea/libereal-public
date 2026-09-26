import { describe, expect, it } from 'vitest';
import { calculatePrice } from '@/lib/price-engine';

describe('price engine', () => {
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
