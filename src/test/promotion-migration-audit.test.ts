import { describe, expect, it } from 'vitest';
import { auditLegacyPromotionBindings, resolveLegacyPromotionGroups, type PromotionSkuRecord } from '@/lib/promotion-migration-audit';
import type { AddonRuleConfig, RuleConfig } from '@/lib/cart-promotions/types';

const skus: PromotionSkuRecord[] = [
  { productId: 'SYNTH-MAIN', variantId: 'SYNTH-MAIN-1', brand: 'SYNTH-BRAND', catalogNumber: 'SYNTH-MAIN-1', name: 'Synthetic main', spec: '1u' },
  { productId: 'SYNTH-ADDON', variantId: 'SYNTH-ADDON-1', brand: 'SYNTH-BRAND', catalogNumber: 'SYNTH-ADDON-1', name: 'Synthetic add-on', spec: '1u' },
];
const rule = (id: string): AddonRuleConfig => ({ id, type: 'addon', name: id, enabled: true, description: id, eligibleBrand: 'SYNTH-BRAND', eligibleTerms: ['SYNTH-MAIN'], minQuantity: 1, addonPrice: 1, addonBrand: 'SYNTH-BRAND', addonTerms: ['SYNTH-ADDON'] });

describe('synthetic promotion migration audit', () => {
  it('resolves generic qualifier and benefit groups', () => {
    const result = resolveLegacyPromotionGroups(rule('SYNTH-RULE'), skus);
    expect(result.groups.map((group) => [group.key, group.skus.map((sku) => sku.catalogNumber)])).toEqual([
      ['main', ['SYNTH-MAIN-1']], ['benefit', ['SYNTH-ADDON-1']],
    ]);
  });

  it('reports active rule overlap and excludes disabled rules', () => {
    const report = auditLegacyPromotionBindings([rule('SYNTH-A'), rule('SYNTH-B'), { ...rule('SYNTH-OFF'), enabled: false }], skus, new Date('2026-09-01'));
    expect(report.overlaps).toEqual([{ firstRuleId: 'SYNTH-A', secondRuleId: 'SYNTH-B', skuCount: 2, examples: ['SYNTH-MAIN-1', 'SYNTH-ADDON-1'] }]);
    expect(report.rules.find((entry) => entry.id === 'SYNTH-OFF')?.lifecycle).toBe('disabled');
  });

  it('treats an empty same-product qualifier list as all brand products', () => {
    const gift: RuleConfig = { id: 'SYNTH-GIFT', type: 'gift', name: 'gift', enabled: true, description: '', eligibleBrand: 'SYNTH-BRAND', eligibleTerms: [], minQuantity: 1, sameProduct: true, giftTerms: ['SYNTH-ADDON'] };
    expect(resolveLegacyPromotionGroups(gift, skus).groups[0].skus.map((sku) => sku.catalogNumber)).toEqual(['SYNTH-MAIN-1', 'SYNTH-ADDON-1']);
  });

  it('uses exact qualifiers and closed selectable options', () => {
    const configured: RuleConfig = { ...rule('SYNTH-EXACT'), eligibleTerms: [], eligibleExactTerms: ['SYNTH-MAIN-1'], addonTerms: ['SYNTH-ADDON'], addonOptions: [{ catalogNumber: 'SYNTH-ADDON-1', price: 2, quantity: 1 }] };
    const resolved = resolveLegacyPromotionGroups(configured, skus);
    expect(resolved.groups.map((group) => group.skus.map((sku) => sku.catalogNumber))).toEqual([['SYNTH-MAIN-1'], ['SYNTH-ADDON-1']]);
  });
});
