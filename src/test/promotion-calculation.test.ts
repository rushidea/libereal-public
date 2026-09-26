import { describe, expect, it } from 'vitest';
import { calculateBoundPromotions, type BoundPromotion, type PromotionPricingLine } from '@/data/promotion-calculation';
const campaign: BoundPromotion = {
  id: 'addon', name: '加购', version: 1, status: 'active', startsAt: new Date('2026-01-01'), endsAt: new Date('2027-01-01'),
  bindings: [{ productId: 'sample-main', variantId: null, groupKey: 'main' }, { productId: 'sample-addon', variantId: 'roll', groupKey: 'addon' }],
  definition: { schemaVersion: 1, template: 'addon', repeat: true, maxApplications: null, partialBenefit: true,
    groups: [{ key: 'main', role: 'qualifier', unit: '盒', quantity: 6 }, { key: 'addon', role: 'benefit', unit: '卷', quantity: 1 }],
    benefit: { kind: 'fixed-price', unitPriceCents: 5000 } },
};
const now = new Date('2026-09-05');
const main: PromotionPricingLine = { id: 'm', productId: 'sample-main', variantId: null, quantity: 6, unitPriceCents: 10000, basePriceCents: 10000 };
const addon: PromotionPricingLine = { id: 'a', productId: 'sample-addon', variantId: 'roll', quantity: 1, unitPriceCents: 30000, basePriceCents: 30000 };
const calculate = (lines = [main, addon], rules = [campaign]) => calculateBoundPromotions(lines, rules, now);
describe('绑定规则共享计价', () => {
  it('六盒主品后的附属品收取50元', () => {
    expect(calculate().lineDiscounts).toEqual({ a: 25000 });
    expect(calculate().lineRules).toEqual({ m: { id: 'addon', version: 1 }, a: { id: 'addon', version: 1 } });
  });
  it('次序变化与重复商品行仍使用同一个规则', () => {
    expect(calculate([addon, { ...main, quantity: 3 }, { ...main, id: 'm2', quantity: 3 }]).discountCents).toBe(25000);
  });
  it('未达门槛、错误规格、过期与暂停活动保持普通价格', () => {
    expect(calculate([{ ...main, quantity: 5 }, addon]).discountCents).toBe(0);
    expect(calculate([main, { ...addon, variantId: 'other' }]).discountCents).toBe(0);
    expect(calculate(undefined, [{ ...campaign, endsAt: now }]).discountCents).toBe(0);
    expect(calculate(undefined, [{ ...campaign, status: 'paused' }]).discountCents).toBe(0);
  });
  it('多件附属品只在额度内优惠', () => {
    expect(calculate([main, { ...addon, quantity: 3 }]).discountCents).toBe(25000);
    expect(calculate([{ ...main, quantity: 12 }, { ...addon, quantity: 3 }]).discountCents).toBe(50000);
  });
  it('重复参与开关和每单次数生效', () => {
    const lines = [{ ...main, quantity: 18 }, { ...addon, quantity: 3 }];
    expect(calculate(lines, [{ ...campaign, definition: { ...campaign.definition, repeat: false } }]).discountCents).toBe(25000);
    expect(calculate(lines, [{ ...campaign, definition: { ...campaign.definition, maxApplications: 2 } }]).discountCents).toBe(50000);
  });
  it('同一件商品只分配给一条规则，增加数量后剩余件数可参与另一条规则', () => {
    const second: BoundPromotion = {
      ...campaign, id: 'second', priority: 0,
      definition: { ...campaign.definition, groups: [
        { ...campaign.definition.groups[0], quantity: 1 }, campaign.definition.groups[1],
      ] },
      bindings: [{ productId: 'sample-addon', variantId: 'roll', groupKey: 'main' }, { productId: 'tube', variantId: null, groupKey: 'addon' }],
    };
    const first = { ...campaign, priority: 10 };
    const tube: PromotionPricingLine = { id: 't', productId: 'tube', variantId: null, quantity: 1, unitPriceCents: 20000, basePriceCents: 20000 };
    const one = calculate([main, addon, tube], [second, first]);
    expect(one.appliedRules).toEqual({ addon: 1 });
    expect(one.lineAllocations.a).toEqual([{ id: 'addon', version: 1, quantity: 1, discountCents: 25000 }]);
    const two = calculate([main, { ...addon, quantity: 2 }, tube], [second, first]);
    expect(two.appliedRules).toEqual({ addon: 1, second: 1 });
    expect(two.lineAllocations.a).toEqual([
      { id: 'addon', version: 1, quantity: 1, discountCents: 25000 },
      { id: 'second', version: 1, quantity: 1, discountCents: 0 },
    ]);
    expect(two.lineAllocations.t).toEqual([{ id: 'second', version: 1, quantity: 1, discountCents: 15000 }]);
  });
  it('无关活动不显示提示', () => {
    expect(calculate([{ ...main, productId: 'unrelated' }]).statuses).toEqual([]);
  });
  it('整组2元购买2件需要完整数量，分摊金额精确到分', () => {
    const grouped: BoundPromotion = { ...campaign, definition: { ...campaign.definition, partialBenefit: false,
      groups: [campaign.definition.groups[0], { ...campaign.definition.groups[1], quantity: 2 }],
      benefit: { kind: 'group-price', groupPriceCents: 201 } } };
    expect(calculate(undefined, [grouped]).discountCents).toBe(0);
    const result = calculate([main, addon, { ...addon, id: 'a2', unitPriceCents: 20000 }], [grouped]);
    expect(result.discountCents).toBe(49799);
    expect(Object.values(result.lineDiscounts).reduce((sum, amount) => sum + amount, 0)).toBe(result.discountCents);
  });
  it('活动价不会高于已有普通成交价', () => {
    expect(calculate([main, { ...addon, unitPriceCents: 4000 }]).discountCents).toBe(0);
  });
  it('百分比按基准价计算，与普通价比较，不重复叠加会员折扣', () => {
    const discounted = { ...campaign, definition: { ...campaign.definition, benefit: { kind: 'percentage' as const, basisPoints: 5000 } } };
    expect(calculate([main, { ...addon, unitPriceCents: 20000 }], [discounted]).discountCents).toBe(5000);
  });
  it('同款买赠按具体规格分别计算', () => {
    const same: BoundPromotion = { ...campaign, definition: { ...campaign.definition, template: 'same-sku-gift', freeQuantity: 1,
      groups: [{ key: 'main', role: 'qualifier-and-benefit', quantity: 2, unit: '件' }], benefit: { kind: 'gift' } },
      bindings: [{ productId: 'sample-main', variantId: null, groupKey: 'main' }, { productId: 'sample-main', variantId: 'large', groupKey: 'main' }] };
    expect(calculate([{ ...main, quantity: 1 }, { ...main, id: 'b', quantity: 1, variantId: 'large' }], [same]).discountCents).toBe(0);
    expect(calculate([{ ...main, quantity: 3 }], [same]).discountCents).toBe(10000);
    expect(calculate([{ ...main, quantity: 1 }, { ...main, id: 'b', quantity: 1 }], [same]).discountCents).toBe(10000);
  });
  it('买三免一按价格分组，每组最低价免费', () => {
    const buy: BoundPromotion = { ...campaign, definition: { ...campaign.definition, template: 'buy-n-get-m', freeQuantity: 1,
      groups: [{ key: 'main', role: 'qualifier-and-benefit', quantity: 3, unit: '件' }], benefit: { kind: 'gift' } },
      bindings: [{ productId: 'sample-main', variantId: null, groupKey: 'main' }, { productId: 'sample-addon', variantId: 'roll', groupKey: 'main' }] };
    expect(calculate([{ ...main, quantity: 1 }, { ...addon, quantity: 2 }], [buy]).discountCents).toBe(10000);
  });
  it('组合规则的同组购买与优惠商品按已占用数量计价', () => {
    const bundle: BoundPromotion = { ...campaign, id: 'bundle', definition: { ...campaign.definition, template: 'bundle',
      groups: [{ key: 'main', role: 'qualifier-and-benefit', quantity: 2, unit: '件' }],
      benefit: { kind: 'fixed-price', unitPriceCents: 5000 } },
      bindings: [{ productId: 'sample-main', variantId: null, groupKey: 'main' }] };
    const result = calculate([{ ...main, quantity: 3 }], [bundle]);
    expect(result.discountCents).toBe(10000);
    expect(result.lineAllocations.m).toEqual([{ id: 'bundle', version: 1, quantity: 2, discountCents: 10000 }]);
  });
  it.each([0, -1, 1.5, NaN, Infinity])('拒绝非法数量 %s', (quantity) => {
    expect(() => calculate([{ ...main, quantity }])).toThrow('INVALID_PROMOTION_AMOUNT');
  });
});
