import { describe, it, expect } from 'vitest';
import {
  getUserBrandDiscount,
  getUserDisplayDiscount,
  applyDiscount,
} from '@/lib/discount';

describe('getUserBrandDiscount', () => {
  it('should use subBrand-specific discount when available', () => {
    const user = {
      brandDiscounts: JSON.stringify({
        'Sample Brand > Sample Category': 0.85,
        'Sample Brand': 0.90,
      }),
    };
    expect(getUserBrandDiscount(user, 'Sample Brand', 'Sample Category')).toBe(0.85);
  });

  it('should fall back to brand discount when subBrand not found', () => {
    const user = {
      brandDiscounts: JSON.stringify({
        'Sample Brand': 0.90,
      }),
    };
    expect(getUserBrandDiscount(user, 'Sample Brand', 'SomeOtherSubBrand')).toBe(0.90);
  });

  it('should use personal discountRate when no brand match', () => {
    const user = {
      discountRate: 0.85,
      brandDiscounts: JSON.stringify({}),
    };
    expect(getUserBrandDiscount(user, 'Unknown Brand', null)).toBe(0.85);
  });

  it('should fall back to tier discount when no brand or personal discount', () => {
    const user = { tier: 'unconfigured' };
    expect(getUserBrandDiscount(user, 'Unknown Brand', null)).toBe(1.00);
  });

  it('should return 1.00 for unknown tier', () => {
    const user = { tier: 'UnknownTier' };
    expect(getUserBrandDiscount(user, 'Unknown Brand', null)).toBe(1.00);
  });

  it('should handle string brandDiscounts parsing', () => {
    const user = {
      brandDiscounts: '{"Sample Brand": 0.88}',
    };
    expect(getUserBrandDiscount(user, 'Sample Brand', null)).toBe(0.88);
  });

  it('should return 1.00 when user has no discount info', () => {
    const user = {};
    expect(getUserBrandDiscount(user, 'AnyBrand', null)).toBe(1.00);
  });
});

describe('getUserDisplayDiscount', () => {
  it('should return personal discountRate when set', () => {
    const user = { discountRate: 0.90, tier: 'tier-5' };
    expect(getUserDisplayDiscount(user)).toBe(0.90);
  });

  it('should fall back to tier rate when discountRate is null', () => {
    const user = { discountRate: null, tier: 'unconfigured' };
    expect(getUserDisplayDiscount(user)).toBe(1.00);
  });

  it('should fall back to tier rate when discountRate is undefined', () => {
    const user = { tier: 'unconfigured' };
    expect(getUserDisplayDiscount(user)).toBe(1.00);
  });

  it('should return 1.00 for unknown tier', () => {
    const user = { tier: 'UnknownTier' };
    expect(getUserDisplayDiscount(user)).toBe(1.00);
  });
});

describe('applyDiscount', () => {
  it('should apply discount rate correctly', () => {
    expect(applyDiscount(100, 1.00)).toBe(100);
    expect(applyDiscount(100, 0.90)).toBe(90);
    expect(applyDiscount(100, 0.70)).toBe(70);
  });

  it('should round to 2 decimal places', () => {
    expect(applyDiscount(99.99, 0.85)).toBe(84.99);
    expect(applyDiscount(33.33, 0.70)).toBe(23.33);
  });

  it('should handle small prices', () => {
    expect(applyDiscount(0.50, 0.80)).toBe(0.40);
  });

  it('should handle large prices', () => {
    expect(applyDiscount(9999.99, 0.90)).toBe(8999.99);
  });
});
