import { describe, expect, it } from 'vitest';
import { catalogPercentageCents, catalogReferenceCents } from '@/lib/promotion-catalog-pricing';

describe('trusted catalog reference pricing', () => {
  it('uses the selected variant rather than its product and applies a single percentage', () => {
    const base = catalogReferenceCents({ productId: 'p1', productOriginalPrice: 1000,
      variant: { id: 'v1', productId: 'p1', originalPrice: 200 } });
    expect(base).toBe(20000);
    expect(catalogPercentageCents(base, 6000)).toBe(12000);
  });
  it('uses the product reference only for the product itself', () => {
    expect(catalogReferenceCents({ productId: 'p1', productOriginalPrice: 1000, variant: null })).toBe(100000);
    expect(() => catalogReferenceCents({ productId: 'p1', productOriginalPrice: 1000,
      variant: { id: 'v1', productId: 'p1', originalPrice: null } })).toThrow('PROMOTION_CATALOG_PRICE_REQUIRED');
    expect(() => catalogReferenceCents({ productId: 'p1', productOriginalPrice: 1000,
      variant: { id: 'v1', productId: 'p1', originalPrice: 0 } })).toThrow('PROMOTION_CATALOG_PRICE_REQUIRED');
  });
  it('rejects mismatched variants and invalid or zero-valued results', () => {
    expect(() => catalogReferenceCents({ productId: 'p1', productOriginalPrice: 1000,
      variant: { id: 'v1', productId: 'p2', originalPrice: 100 } })).toThrow('INVALID_PROMOTION_VARIANT');
    expect(() => catalogPercentageCents(1, 1)).toThrow('PROMOTION_CATALOG_PRICE_REQUIRED');
    expect(() => catalogPercentageCents(100, 0)).toThrow('INVALID_PROMOTION_AMOUNT');
  });
  it('rounds a half cent consistently', () => {
    expect(catalogPercentageCents(101, 5000)).toBe(51);
    expect(catalogReferenceCents({ productId: 'p1', productOriginalPrice: 10.075, variant: null })).toBe(1008);
  });
  it('handles exponent notation and rejects unsafe totals', () => {
    expect(catalogReferenceCents({ productId: 'p1', productOriginalPrice: 1.25e2, variant: null })).toBe(12500);
    expect(() => catalogReferenceCents({ productId: 'p1', productOriginalPrice: 1e-7, variant: null })).toThrow('PROMOTION_CATALOG_PRICE_REQUIRED');
    expect(() => catalogReferenceCents({ productId: 'p1', productOriginalPrice: 1e30, variant: null })).toThrow('PROMOTION_CATALOG_PRICE_REQUIRED');
    expect(() => catalogPercentageCents(Number.MAX_SAFE_INTEGER, 10000)).toThrow('INVALID_PROMOTION_AMOUNT');
  });
});
