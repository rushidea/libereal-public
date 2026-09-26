import { describe, expect, it } from 'vitest';
import { findPromotionConflicts, parsePromotionDefinition, validatePromotionBindings,
  type PromotionAssignment, type PromotionDefinition } from '@/data/promotion-foundation';

const definition: PromotionDefinition = {
  schemaVersion: 1, template: 'addon', repeat: true, maxApplications: null, partialBenefit: true,
  groups: [
    { key: 'main', role: 'qualifier', quantity: 6, unit: '盒' },
    { key: 'addon', role: 'benefit', quantity: 1, unit: '卷' },
  ], benefit: { kind: 'fixed-price', unitPriceCents: 5000 },
};
const bindings = [
  { productId: 'sample-main', variantId: null, groupKey: 'main' },
  { productId: 'membrane', variantId: 'small', groupKey: 'addon' },
];
const assignment: PromotionAssignment = {
  id: 'first', status: 'active', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-10-01'), bindings,
};

describe('促销规则与 SKU 绑定基础定义', () => {
  it('规则定义仅包含机制，商品绑定独立保存', () => {
    expect(parsePromotionDefinition(definition)).toEqual(definition);
    expect(() => validatePromotionBindings(definition, bindings)).not.toThrow();
  });
  it('规范化结果只包含允许的规则字段', () => {
    expect(parsePromotionDefinition({ ...definition, extra: 'ignored',
      benefit: { ...definition.benefit, internalValue: 123 },
      groups: definition.groups.map((group) => ({ ...group, products: ['untrusted'] })),
    })).toEqual(definition);
  });
  it.each([null, {}, { ...definition, schemaVersion: 2 }, { ...definition, repeat: 'true' },
    { ...definition, maxApplications: 0 }, { ...definition, groups: [] },
    { ...definition, benefit: { kind: 'fixed-price', unitPriceCents: 0.5 } },
    { ...definition, benefit: { kind: 'percentage', basisPoints: 10001 } },
    { ...definition, benefit: { kind: 'group-price', groupPriceCents: 200 } },
  ])('拒绝非法规则参数 %#', (value) => {
    expect(() => parsePromotionDefinition(value)).toThrow();
  });
  it('整组活动价需要完整购买', () => {
    expect(parsePromotionDefinition({ ...definition, partialBenefit: false,
      benefit: { kind: 'group-price', groupPriceCents: 200 } }).partialBenefit).toBe(false);
  });
  it('同一个 SKU 不能重复绑定到不同参与组', () => {
    expect(() => validatePromotionBindings(definition, [...bindings, { ...bindings[0], groupKey: 'addon' }])).toThrow('DUPLICATE_PROMOTION_SKU');
  });
  it('同款买赠明确区分总数量和免费数量', () => {
    const sameSku = { ...definition, template: 'same-sku-gift', freeQuantity: 1,
      groups: [{ key: 'main', role: 'qualifier-and-benefit', quantity: 2, unit: '盒' }], benefit: { kind: 'gift' } };
    expect(parsePromotionDefinition(sameSku).freeQuantity).toBe(1);
    expect(() => parsePromotionDefinition({ ...sameSku, freeQuantity: 2 })).toThrow('INVALID_PROMOTION_FREE_QUANTITY');
    expect(() => parsePromotionDefinition({ ...sameSku, freeQuantity: undefined })).toThrow('INVALID_PROMOTION_FREE_QUANTITY');
  });
  it('普通加购不允许主品同时充当附属品', () => {
    expect(() => parsePromotionDefinition({ ...definition, groups: [
      { key: 'main', role: 'qualifier-and-benefit', quantity: 6, unit: '盒' },
    ] })).toThrow('INVALID_PROMOTION_GROUP_ROLES');
  });
  it('拒绝重复分组和负数门槛', () => {
    expect(() => parsePromotionDefinition({ ...definition, groups: [definition.groups[0], definition.groups[0]] })).toThrow('INVALID_PROMOTION_GROUP');
    expect(() => parsePromotionDefinition({ ...definition, groups: [{ ...definition.groups[0], quantity: -1 }] })).toThrow('INVALID_PROMOTION_GROUP');
  });
  it('无规格商品与具体规格使用独立身份', () => {
    expect(() => validatePromotionBindings(definition, [...bindings,
      { productId: 'sample-main', variantId: 'large', groupKey: 'main' },
    ])).not.toThrow();
  });
  it('拒绝不存在的组绑定', () => {
    expect(() => validatePromotionBindings(definition, [{ ...bindings[0], groupKey: 'missing' }])).toThrow('INVALID_PROMOTION_BINDING');
  });
  it('发布前每个参与组都需要 SKU', () => {
    expect(() => validatePromotionBindings(definition, bindings.slice(0, 1))).toThrow('PROMOTION_GROUP_WITHOUT_SKUS');
  });
  it('有效期重叠的同 SKU 活动产生冲突', () => {
    expect(findPromotionConflicts(assignment, [{ ...assignment, id: 'second' }])).toEqual(['second']);
  });
  it('同活动修改、暂停活动及相邻有效期无冲突', () => {
    expect(findPromotionConflicts(assignment, [assignment,
      { ...assignment, id: 'paused', status: 'paused' },
      { ...assignment, id: 'later', startsAt: assignment.endsAt, endsAt: new Date('2026-11-01') },
    ])).toEqual([]);
  });
  it('规格精确绑定，不通过商品名称或父商品推测', () => {
    expect(findPromotionConflicts(assignment, [{ ...assignment, id: 'different', bindings: [
      { productId: 'membrane', variantId: 'large', groupKey: 'addon' },
    ] }])).toEqual([]);
  });
  it('无效的有效活动日期阻止冲突检查', () => {
    expect(() => findPromotionConflicts(assignment, [{ ...assignment, id: 'invalid', endsAt: new Date('invalid') }])).toThrow('INVALID_PROMOTION_PERIOD');
  });
});
