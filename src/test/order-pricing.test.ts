import { describe, expect, it } from 'vitest';
import { parsePricingSnapshot } from '@/data/order-pricing';

describe('order pricing display', () => {
  it('parses the stored calculation steps', () => {
    const result = parsePricingSnapshot(JSON.stringify({
      finalPrice: 99,
      currency: 'CNY',
      appliedSource: 'user_discount',
      minimumPriceApplied: false,
      steps: [
        { stage: 'base', source: 'base_price', before: 100, after: 100, applied: true, reason: '商品基础价格' },
        { stage: 'tier_discount', source: 'tier:tier-2', before: 100, after: 99, applied: true, reason: '用户等级折扣' },
      ],
    }));

    expect(result?.finalPrice).toBe(99);
    expect(result?.steps).toHaveLength(2);
    expect(result?.steps[1]).toMatchObject({ stage: 'tier_discount', before: 100, after: 99, applied: true });
  });

  it('returns null for malformed or incomplete snapshots', () => {
    expect(parsePricingSnapshot('not-json')).toBeNull();
    expect(parsePricingSnapshot(JSON.stringify({ steps: [] }))).toBeNull();
    expect(parsePricingSnapshot(null)).toBeNull();
  });
});
