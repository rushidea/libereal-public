import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoundPromotion } from '@/data/promotion-calculation';
const mocks = vi.hoisted(() => ({ enabled: true, campaigns: [] as BoundPromotion[] }));
vi.mock('@/lib/promotion-repository', () => ({ foundationEnabled: () => mocks.enabled,
  withPromotionRepository: (action: (repository: unknown) => unknown) => action({ activeForProducts: () => mocks.campaigns }) }));
import { assertPromotionVersions, computeOrderPromotions } from '@/lib/promotion-order';
const campaign: BoundPromotion = { id: 'rule', name: '50元加购', version: 3, status: 'active', startsAt: new Date('2026-01-01'), endsAt: new Date('2027-01-01'),
  definition: { schemaVersion: 1, template: 'addon', repeat: true, maxApplications: null, partialBenefit: true,
    groups: [{ key: 'main', role: 'qualifier', unit: '盒', quantity: 6 }, { key: 'addon', role: 'benefit', unit: '卷', quantity: 1 }], benefit: { kind: 'fixed-price', unitPriceCents: 5000 } },
  bindings: [{ productId: 'sample-main', variantId: null, groupKey: 'main' }, { productId: 'sample-addon', variantId: 'roll', groupKey: 'addon' }] };
describe('订单规则计价适配', () => {
  beforeEach(() => { mocks.enabled = true; mocks.campaigns = [campaign]; });
  it('只使用服务端核验后的商品身份与价格', () => {
    const result = computeOrderPromotions([
      { productId: 'sample-main', variantId: null, name: '胶', catalogNumber: 'G', brand: 'B', baseUnitPrice: 100, unitPrice: 80, quantity: 6, lineTotal: 480, priceMismatch: false, source: 'db', pricingSnapshot: '{}' },
      { productId: 'sample-addon', variantId: 'roll', name: '膜', catalogNumber: 'P', brand: 'B', baseUnitPrice: 300, unitPrice: 300, quantity: 1, lineTotal: 300, priceMismatch: false, source: 'db', pricingSnapshot: '{}' },
    ], [{ productId: 'forged', variantId: null, name: '伪造', price: 0 }, { productId: 'forged2', variantId: null, name: '伪造', price: 0 }], new Date('2026-09-05'));
    expect(result.discountTotal).toBe(250);
    expect(result.lineDiscounts).toEqual({ '1': 250 });
    expect(result.lineRules?.['1']).toEqual({ id: 'rule', version: 3 });
    expect(result.appliedRules).toEqual({ rule: 3 });
    expect(result.candidateRules).toEqual({ rule: 3 });
    expect(result.lineAllocations?.['0']).toEqual([{ id: 'rule', version: 3, quantity: 6, discountCents: 0 }]);
    expect(result.lineAllocations?.['1']).toEqual([{ id: 'rule', version: 3, quantity: 1, discountCents: 25000 }]);
  });
  it('非数据库商品不参与绑定活动', () => {
    const result = computeOrderPromotions([{ productId: 'sample-main', name: '快速商品', catalogNumber: 'G', unitPrice: 100, quantity: 6, lineTotal: 600, priceMismatch: true, source: 'fallback', pricingSnapshot: '{}' }], []);
    expect(result.discountTotal).toBe(0);
  });
  it('下单事务内重新确认活动版本和有效状态', async () => {
    const active = { id: 'rule', ruleVersion: 3, status: 'active', startsAt: new Date('2026-01-01'), endsAt: new Date('2027-01-01') };
    const tx = { $queryRaw: vi.fn().mockResolvedValue([active]) };
    await expect(assertPromotionVersions(tx as never, { '0': { id: 'rule', version: 3 } }, new Date('2026-09-05'))).resolves.toBeUndefined();
    await expect(assertPromotionVersions(tx as never, { rule: 3 }, new Date('2026-09-05'))).resolves.toBeUndefined();
    tx.$queryRaw.mockResolvedValue([{ ...active, ruleVersion: 4 }]);
    await expect(assertPromotionVersions(tx as never, { '0': { id: 'rule', version: 3 } }, new Date('2026-09-05'))).rejects.toThrow('PROMOTION_CHANGED');
  });
  it('下单事务拒绝候选规则集合发生变化', async () => {
    const active = { id: 'rule', ruleVersion: 3, status: 'active', startsAt: new Date('2026-01-01'), endsAt: new Date('2027-01-01') };
    const tx = { $queryRaw: vi.fn().mockResolvedValue([active]) };
    await expect(assertPromotionVersions(tx as never, { rule: 3 }, new Date('2026-09-05'), ['sample-main'])).resolves.toBeUndefined();
    tx.$queryRaw.mockResolvedValue([active, { ...active, id: 'new-rule', ruleVersion: 1 }]);
    await expect(assertPromotionVersions(tx as never, { rule: 3 }, new Date('2026-09-05'), ['sample-main'])).rejects.toThrow('PROMOTION_CHANGED');
    tx.$queryRaw.mockResolvedValue([{ ...active, ruleVersion: 4 }]);
    await expect(assertPromotionVersions(tx as never, { rule: 3 }, new Date('2026-09-05'), ['sample-main'])).rejects.toThrow('PROMOTION_CHANGED');
  });
});
