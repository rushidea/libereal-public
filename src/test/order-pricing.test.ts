import { describe, expect, it } from 'vitest';
import { parsePricingSnapshot } from '@/data/order-pricing';
import { customerVisiblePricingSnapshot } from '@/lib/commerce-records';

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

  it('parses customer-sanitized pricing steps without exposing promotion identifiers', () => {
    const visible = customerVisiblePricingSnapshot(JSON.stringify({
      finalPrice: 80,
      appliedSource: 'promotion:private-campaign-id',
      referencePriceApplied: true,
      steps: [{ stage: 'promotion', source: 'promotion:private-campaign-id', reason: 'Private campaign internal rule', before: 100, after: 80, applied: true }],
    }));
    const result = parsePricingSnapshot(visible);
    expect(result?.steps).toEqual([{
      stage: 'promotion', source: 'promotion', reason: '活动优惠', before: 100, after: 80, applied: true,
    }]);
    expect(visible).not.toContain('private-campaign-id');
    expect(visible).not.toContain('Private campaign internal rule');
  });

  it('returns null for malformed or incomplete snapshots', () => {
    expect(parsePricingSnapshot('not-json')).toBeNull();
    expect(parsePricingSnapshot(JSON.stringify({ steps: [] }))).toBeNull();
    expect(parsePricingSnapshot(null)).toBeNull();
  });
});
