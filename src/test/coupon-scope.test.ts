import { describe, expect, it } from 'vitest';
import { couponStrategy } from '@/lib/cart-promotions/strategies/coupon';
import type { CartLine, CouponRuleConfig, RuleContext } from '@/lib/cart-promotions/types';
import {
  COUPON_SCOPE_EMPTY_MESSAGE,
  formatCouponScopeLabel,
  normalizeCouponScopeInput,
  parseCouponScope,
} from '@/lib/coupon-scope';

function line(over: Partial<CartLine['product']> & { price: number }, quantity = 1, extra: Partial<CartLine> = {}): CartLine {
  return {
    product: {
      id: over.id ?? 'p1',
      brand: over.brand ?? 'Abcepta',
      catalogNumber: over.catalogNumber ?? 'AB1',
      price: over.price,
      category: over.category,
      subcategory: over.subcategory,
      variantId: over.variantId,
      delisted: over.delisted,
      name: over.name,
      promotionIdentity: over.promotionIdentity,
    },
    quantity,
    ...extra,
  };
}

function coupon(over: Partial<CouponRuleConfig> = {}): CouponRuleConfig {
  return {
    id: 'coupon:TEST',
    type: 'coupon',
    couponId: 'c1',
    couponType: 'threshold',
    code: 'TESTCODE',
    name: '测试券',
    enabled: true,
    threshold: 100,
    discount: 30,
    stackable: false,
    approvalStatus: 'auto',
    issueApprovalStatus: 'auto',
    description: '测试券',
    ...over,
  };
}

function evaluate(config: CouponRuleConfig, items: CartLine[]) {
  const ctx: RuleContext = { items, now: new Date(), rules: [config] };
  return couponStrategy.evaluate(config, ctx);
}

describe('coupon scope eligibility', () => {
  it('treats coupons without a scope as site-wide', () => {
    const result = evaluate(coupon(), [
      line({ id: 'a', brand: 'Abcepta', price: 80 }),
      line({ id: 'b', brand: '其他', price: 40 }),
    ]);
    expect(result.triggered).toBe(true);
    expect(result.adjustments[0]?.amount).toBe(30);
    expect(result.details?.subtotal).toBe(120);
  });

  it('parses missing and all scopes as site-wide labels', () => {
    expect(parseCouponScope(undefined, undefined)).toEqual({ type: 'all' });
    expect(parseCouponScope('all', '[]')).toEqual({ type: 'all' });
    expect(parseCouponScope('', null)).toEqual({ type: 'all' });
    expect(formatCouponScopeLabel({ type: 'all' })).toBe('全站商品');
  });

  it('counts only the selected brands toward the threshold', () => {
    const config = coupon({
      scope: { type: 'brand', brands: ['Abcepta'] },
    });
    const below = evaluate(config, [
      line({ id: 'a', brand: 'Abcepta', price: 80 }),
      line({ id: 'b', brand: '其他', price: 50 }),
    ]);
    expect(below.triggered).toBe(false);
    expect(below.summary).toContain('还差 ¥20.00');
    expect(below.details?.subtotal).toBe(80);

    const met = evaluate(config, [
      line({ id: 'a', brand: 'Abcepta', price: 60 }, 2),
      line({ id: 'b', brand: '其他', price: 500 }),
    ]);
    expect(met.triggered).toBe(true);
    expect(met.adjustments[0]?.amount).toBe(30);
    expect(met.details?.subtotal).toBe(120);
    expect(formatCouponScopeLabel(config.scope!)).toBe('仅限 Abcepta 品牌');
  });

  it('matches category or subcategory and ignores other lines', () => {
    const config = coupon({
      threshold: 50,
      discount: 10,
      scope: { type: 'category', categories: ['一抗', 'WB抗体'] },
    });
    const result = evaluate(config, [
      line({ id: 'a', category: '一抗', price: 30 }),
      line({ id: 'b', category: '二抗', subcategory: 'WB抗体', price: 25 }),
      line({ id: 'c', category: '化学试剂', price: 200 }),
    ]);
    expect(result.triggered).toBe(true);
    expect(result.details?.subtotal).toBe(55);
    expect(result.adjustments[0]?.amount).toBe(10);
    expect(formatCouponScopeLabel(config.scope!)).toBe('仅限 一抗、WB抗体 品类');
  });

  it('matches a whole product or one variant', () => {
    const whole = coupon({
      threshold: 40,
      discount: 15,
      scope: { type: 'product', products: [{ productId: 'p1', variantId: null, label: 'AB1 · 抗体' }] },
    });
    expect(evaluate(whole, [
      line({ id: 'p1', variantId: 'v1', price: 20 }),
      line({ id: 'p1', variantId: 'v2', price: 25 }),
      line({ id: 'p2', price: 100 }),
    ]).details?.subtotal).toBe(45);

    const spec = coupon({
      threshold: 20,
      discount: 8,
      scope: { type: 'product', products: [{ productId: 'p1', variantId: 'v2', label: 'AB1 · 抗体 · 100μL' }] },
    });
    const result = evaluate(spec, [
      line({ id: 'p1', variantId: 'v1', price: 80 }),
      line({ id: 'p1', variantId: 'v2', price: 25 }),
    ]);
    expect(result.triggered).toBe(true);
    expect(result.details?.subtotal).toBe(25);
    expect(result.adjustments[0]?.amount).toBe(8);
    expect(formatCouponScopeLabel(spec.scope!)).toBe('仅限 AB1 · 抗体 · 100μL');
  });

  it('caps the discount at the in-scope subtotal', () => {
    const result = evaluate(coupon({
      threshold: 0,
      discount: 80,
      stackable: true,
      scope: { type: 'brand', brands: ['Abcepta'] },
    }), [
      line({ brand: 'Abcepta', price: 12.5 }, 2),
      line({ id: 'other', brand: '其他', price: 500 }),
    ]);
    expect(result.triggered).toBe(true);
    expect(result.adjustments[0]?.amount).toBe(25);
    expect(result.adjustments[0]?.meta).toMatchObject({ stackable: true });
    expect(result.adjustments[0]?.catalogNumber).toBeUndefined();
  });

  it('rejects a coupon when nothing in scope matches', () => {
    const result = evaluate(coupon({
      scope: { type: 'brand', brands: ['Abcepta'] },
    }), [line({ brand: '其他', price: 500 })]);
    expect(result.triggered).toBe(false);
    expect(result.adjustments).toEqual([]);
    expect(result.summary).toContain(COUPON_SCOPE_EMPTY_MESSAGE);
  });

  it('excludes delisted products from every scope, including site-wide coupons', () => {
    const listed = line({ id: 'live', brand: 'Abcepta', category: '一抗', price: 40 });
    const delisted = line({ id: 'gone', brand: 'Abcepta', category: '一抗', price: 200, delisted: true });

    const sitewide = evaluate(coupon({ threshold: 100, discount: 20 }), [listed, delisted]);
    expect(sitewide.triggered).toBe(false);
    expect(sitewide.details?.subtotal).toBe(40);

    const onlyDelisted = evaluate(coupon(), [delisted]);
    expect(onlyDelisted.triggered).toBe(false);
    expect(onlyDelisted.summary).toContain(COUPON_SCOPE_EMPTY_MESSAGE);

    const brand = evaluate(coupon({
      threshold: 30,
      discount: 10,
      scope: { type: 'brand', brands: ['Abcepta'] },
    }), [listed, delisted]);
    expect(brand.details?.subtotal).toBe(40);
    expect(brand.adjustments[0]?.amount).toBe(10);

    const product = evaluate(coupon({
      threshold: 10,
      scope: { type: 'product', products: [{ productId: 'gone', variantId: null }] },
    }), [delisted]);
    expect(product.summary).toContain(COUPON_SCOPE_EMPTY_MESSAGE);
  });

  it('excludes configured promotion lines before threshold and discount, then applies coupon scope', () => {
    const config = coupon({
      threshold: 500,
      discount: 0.55,
      promotionPolicy: { state: 'restricted', promotionIds: ['configured-promo'] },
      scope: { type: 'brand', brands: ['Eligible'] },
    });
    const result = evaluate(config, [
      line({ id: 'eligible', brand: 'Eligible', price: 600, promotionIdentity: { state: 'knownnone' } }),
      line({ id: 'promo', brand: 'Eligible', price: 400, promotionIdentity: { state: 'restricted', promotionId: 'configured-promo' } }),
      line({ id: 'other-scope', brand: 'Other', price: 900, promotionIdentity: { state: 'unknown' } }),
      line({ id: 'promo-marked', brand: 'Eligible', price: 1000, promotionIdentity: { state: 'unknown' } }, 1, { promoMark: { ruleId: 'gift' } }),
    ]);
    expect(result.triggered).toBe(true);
    expect(result.details?.subtotal).toBe(600);
    expect(result.adjustments[0]?.amount).toBe(0.55);
  });

  it('checks the configured threshold against eligible subtotal at the exact boundary', () => {
    const config = coupon({ threshold: 500, promotionPolicy: { state: 'restricted', promotionIds: ['configured-promo'] } });
    const promotional = line({ price: 400, promotionIdentity: { state: 'restricted', promotionId: 'configured-promo' } });
    const boundary = evaluate(config, [
      line({ price: 500, promotionIdentity: { state: 'knownnone' } }), promotional,
    ]);
    const below = evaluate(config, [
      line({ price: 499.99, promotionIdentity: { state: 'knownnone' } }), promotional,
    ]);
    expect(boundary.triggered).toBe(true);
    expect(boundary.details?.subtotal).toBe(500);
    expect(below.triggered).toBe(false);
    expect(below.details?.subtotal).toBe(499.99);
  });

  it('fails closed on unknown or missing promotion identity when policy is configured', () => {
    const config = coupon({ promotionPolicy: { state: 'restricted', promotionIds: ['configured-promo'] } });
    for (const identity of [undefined, { state: 'unknown' as const }]) {
      const result = evaluate(config, [line({ price: 600, promotionIdentity: identity })]);
      expect(result.triggered).toBe(false);
      expect(result.details?.reason).toBe('unknown_promotion_identity');
      expect(result.adjustments).toEqual([]);
    }
  });

  it('permits an unrestricted zero-threshold coupon even when promotion identity is unknown', () => {
    const result = evaluate(coupon({
      couponType: 'unrestricted', threshold: 0, promotionPolicy: { state: 'unknown' },
    }), [line({ price: 40, promotionIdentity: { state: 'unknown' } })]);
    expect(result.triggered).toBe(true);
    expect(result.details?.subtotal).toBe(40);
  });

  it('keeps promo and quick-order lines out of the threshold', () => {
    const result = evaluate(coupon(), [
      line({ price: 80 }),
      line({ id: 'gift', price: 500 }, 1, { promoMark: { ruleId: 'gift', price: 0 } }),
      line({ id: 'quick', price: 500 }, 1, { isQuickOrder: true }),
    ]);
    expect(result.triggered).toBe(false);
    expect(result.summary).toContain('还差 ¥20.00');
  });

  it('does not treat an unrecognized scope as site-wide', () => {
    const scope = parseCouponScope('everywhere', '["Abcepta"]');
    expect(scope).toEqual({ type: 'product', products: [] });
    const result = evaluate(coupon({ scope }), [line({ price: 500 })]);
    expect(result.triggered).toBe(false);
    expect(result.summary).toContain(COUPON_SCOPE_EMPTY_MESSAGE);
  });
});

describe('coupon scope admin input', () => {
  it('defaults omitted scope to the whole catalog', () => {
    expect(normalizeCouponScopeInput(undefined)).toMatchObject({ ok: true, scopeType: 'all', scopeTargets: '[]' });
    expect(normalizeCouponScopeInput({ scopeType: 'all', scopeTargets: ['忽略'] })).toMatchObject({
      ok: true,
      scopeType: 'all',
      scopeTargets: '[]',
    });
  });

  it('rejects empty or invalid restricted scopes', () => {
    expect(normalizeCouponScopeInput({ scopeType: 'brand', scopeTargets: [] })).toMatchObject({ ok: false });
    expect(normalizeCouponScopeInput({ scopeType: 'nope', scopeTargets: [] })).toMatchObject({
      ok: false,
      error: '适用范围类型无效',
    });
  });

  it('drops a specific variant when the whole product is also selected', () => {
    const result = normalizeCouponScopeInput({
      scopeType: 'product',
      scopeTargets: [
        { productId: 'p1', variantId: 'v1', label: '规格' },
        { productId: 'p1', variantId: null, label: '整品' },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope).toEqual({
      type: 'product',
      products: [{ productId: 'p1', variantId: null, label: '整品' }],
    });
  });
});
