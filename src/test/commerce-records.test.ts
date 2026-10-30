import { describe, expect, it } from 'vitest';
import { customerVisiblePricingSnapshot, orderItemView, toOrderItemCreates } from '@/lib/commerce-records';

describe('toOrderItemCreates variant metadata', () => {
  it('preserves variant identity in order item metadata', () => {
    const [row] = toOrderItemCreates([{ productId: 'p1', name: '抗体', price: 100, quantity: 1, variantId: 'variant-1' }]);
    expect(JSON.parse(String(row.metadata))).toMatchObject({ variantId: 'variant-1' });
  });

  it('keeps caller-provided order item metadata intact', () => {
    const [row] = toOrderItemCreates([{
      name: '抗体',
      price: 100,
      quantity: 1,
      variantId: 'other',
      metadata: JSON.stringify({ variantId: 'kept', spec: '100 µL' }),
    }]);
    expect(JSON.parse(String(row.metadata))).toEqual({ variantId: 'kept', spec: '100 µL' });
  });

  it('leaves metadata empty when the line has no variant', () => {
    const [row] = toOrderItemCreates([{ name: '试剂', price: 10, quantity: 1 }]);
    expect(row.metadata).toBeNull();
  });
});

describe('customer-visible pricing snapshots', () => {
  it('preserves customer amounts and stages while removing private pricing provenance', () => {
    expect(customerVisiblePricingSnapshot('{"finalPrice":10,"source":"catalog"}'))
      .toBe('{"finalPrice":10,"source":"catalog"}');
    expect(JSON.parse(customerVisiblePricingSnapshot(JSON.stringify({
      finalPrice: 10,
      referencePriceApplied: true,
      appliedSource: 'promotion:synthetic-private',
      steps: [{ stage: 'promotion', applied: true, before: 20, after: 10, source: 'promotion', reason: 'Synthetic private rule' }],
      legacy: { keep: true },
      couponPromotionPricingEvidence: { candidates: [{ status: 'draft', ruleDefinition: 'synthetic-private' }] },
      couponPromotionIdentity: { state: 'restricted', promotionId: 'synthetic-private' },
      couponPolicyAudits: [{ policyFingerprint: 'private' }],
    }))!)).toEqual({
      finalPrice: 10,
      steps: [{ stage: 'promotion', applied: true, before: 20, after: 10, source: 'promotion', reason: '活动优惠' }],
      legacy: { keep: true },
    });
  });

  it('fails closed on malformed snapshots in the order item view', () => {
    expect(customerVisiblePricingSnapshot('{malformed synthetic-private')).toBeNull();
    const view = orderItemView({
      id: 'item-1', productId: 'p1', catalogNumber: null, name: 'Synthetic item', brand: null,
      unitPrice: 10, clientPrice: null, quantity: 1, quotedQuantity: null, shippedQty: 0,
      leadTime: null, status: 'pending', metadata: null, pricingSnapshot: '{malformed synthetic-private',
    });
    expect(view.pricingSnapshot).toBeNull();
  });
});
