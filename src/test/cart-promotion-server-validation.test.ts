import { describe, expect, it } from 'vitest';
import { promotionEngine } from '@/lib/cart-promotions/engine';
import { hasExceededSelectionAddonQuota, hasMisbrandedEligibleAddonMain, validateAddonPromotionLines, validatePromoMarks } from '@/lib/cart-promotions/service';
import type { AddonRuleConfig, CartLine } from '@/lib/cart-promotions/types';
import { promotionLines, sampleAddonRule } from './cart-promotion-fixtures';
describe('generic server-side add-on validation', () => {
 it('accepts eligible synthetic add-ons', () => { const lines = promotionLines(); expect(validateAddonPromotionLines(lines, promotionEngine.evaluateAll(lines, [sampleAddonRule]))).toBeNull(); });
 it('rejects when threshold is not met', () => { const lines = promotionLines(5); expect(validateAddonPromotionLines(lines, promotionEngine.evaluateAll(lines, [sampleAddonRule]))).toBe('ADDON_NOT_TRIGGERED'); });
 it('rejects an unknown rule or a tampered price', () => { const lines = promotionLines(); const evals = promotionEngine.evaluateAll(lines, [sampleAddonRule]); lines[1].promoMark = { ruleId: 'unknown', price: 50 }; expect(validateAddonPromotionLines(lines, evals)).toBe('PROMOTION_NOT_FOUND'); });
 it('prices repeated selectable bundles per bundle', () => {
  const rule: AddonRuleConfig = { ...sampleAddonRule, id: 'SYNTH-SELECTION', sharedQuotaMode: 'selection', addonOptions: [{ catalogNumber: 'SAMPLE-ADDON-1', price: 50, quantity: 2 }], addonTerms: ['SAMPLE-ADDON'] };
  const lines: CartLine[] = [{ id: 'main', product: { id: 'main', brand: 'Sample', catalogNumber: 'SAMPLE-MAIN-1', price: 100, name: 'Synthetic main' }, quantity: 12 }, { id: 'addon', product: { id: 'addon', brand: 'Sample', catalogNumber: 'SAMPLE-ADDON-1', price: 300, name: 'Synthetic addon' }, quantity: 4, promoMark: { ruleId: rule.id, choice: 'SAMPLE-ADDON-1', price: 50 } }];
  const evals = promotionEngine.evaluateAll(lines, [rule]);
  expect(evals.flatMap((evaluation) => evaluation.adjustments).reduce((sum, adjustment) => sum + adjustment.amount, 0)).toBe(1100);
 });
 it('detects later selection over-quota and wrong-brand qualified mains', () => {
  const rule: AddonRuleConfig = { ...sampleAddonRule, id: 'SYNTH-EXACT', eligibleBrand: 'Sample', eligibleExactTerms: ['SYNTH-EXACT-MAIN'], eligibleTerms: [], sharedQuotaMode: 'selection', addonOptions: [{ catalogNumber: 'SAMPLE-ADDON-1', price: 50, quantity: 1 }] };
  const lines: CartLine[] = [{ id: 'main', product: { id: 'main', brand: 'Other', catalogNumber: 'SYNTH-EXACT-MAIN', price: 100, name: 'Synthetic main' }, quantity: 5 }, { id: 'bad', product: { id: 'addon', brand: 'Sample', catalogNumber: 'SAMPLE-ADDON-1', price: 300, name: 'Synthetic addon' }, quantity: 1, promoMark: { ruleId: rule.id, price: 50 } }];
  const evals = promotionEngine.evaluateAll(lines, [rule]);
  expect(hasMisbrandedEligibleAddonMain(lines, evals)).toBe(true);
  expect(hasExceededSelectionAddonQuota(lines, evals)).toBe(true);
 });
 it('accepts a selectable bundle whose total option price exceeds its unit price', () => {
  const rule: AddonRuleConfig = { ...sampleAddonRule, id: 'SYNTH-BUNDLE', addonOptions: [{ catalogNumber: 'SAMPLE-ADDON-1', price: 150, quantity: 2 }] };
  const lines: CartLine[] = [{ id: 'addon', product: { id: 'addon', brand: 'Sample', catalogNumber: 'SAMPLE-ADDON-1', price: 100, name: 'Synthetic addon' }, quantity: 2, promoMark: { ruleId: rule.id, choice: 'SAMPLE-ADDON-1', price: 150 } }];
  const evaluation = { rule, active: true, triggered: true, summary: '', adjustments: [], details: {} };
  expect(validatePromoMarks(lines, [evaluation])).toEqual([]);
 });
 it('does not let an untriggered rule hide a later invalid marked line', () => {
  const first: AddonRuleConfig = { ...sampleAddonRule, id: 'SYNTH-SOFT', minQuantity: 99 };
  const second: AddonRuleConfig = { ...sampleAddonRule, id: 'SYNTH-HARD', minQuantity: 1, addonPrice: 40, addonTerms: ['SAMPLE-HARD'] };
  const lines: CartLine[] = [
   { id: 'main', product: { id: 'main', brand: 'Sample', catalogNumber: 'SAMPLE-MAIN-1', price: 100, name: 'Synthetic main' }, quantity: 1 },
   { id: 'soft', product: { id: 'soft', brand: 'Sample', catalogNumber: 'SAMPLE-ADDON-1', price: 300, name: 'Synthetic add-on' }, quantity: 1, promoMark: { ruleId: first.id, price: 50 } },
   { id: 'hard', product: { id: 'hard', brand: 'Sample', catalogNumber: 'SAMPLE-HARD-1', price: 300, name: 'Synthetic hard add-on' }, quantity: 1, promoMark: { ruleId: second.id, price: 99 } },
  ];
  expect(validateAddonPromotionLines(lines, promotionEngine.evaluateAll(lines, [first, second]))).toBe('ADDON_PRICE_INVALID');
 });
 it('rejects unlisted options and invalid option choices', () => {
  const rule: AddonRuleConfig = { ...sampleAddonRule, id: 'SYNTH-CLOSED', addonOptions: [{ catalogNumber: 'SYNTH-OPTION-A', price: 25, quantity: 1 }], addonTerms: ['SYNTH-OPTION'] };
  const base: CartLine = { id: 'addon', product: { id: 'addon', brand: 'Sample', catalogNumber: 'SYNTH-OPTION-B', price: 100, name: 'Synthetic option' }, quantity: 1, promoMark: { ruleId: rule.id, price: 25, choice: 'SYNTH-OPTION-A' } };
  const main: CartLine = { id: 'main', product: { id: 'main', brand: 'Sample', catalogNumber: 'SAMPLE-MAIN-1', price: 100, name: 'Synthetic main' }, quantity: 6 };
  const evaluations = promotionEngine.evaluateAll([main, base], [rule]);
  expect(validateAddonPromotionLines([main, base], evaluations)).toBe('ADDON_PRODUCT_INVALID');
  const invalidChoice = { ...base, product: { ...base.product, catalogNumber: 'SYNTH-OPTION-A' }, promoMark: { ...base.promoMark!, choice: 'SYNTH-OPTION-B' } };
  expect(validateAddonPromotionLines([main, invalidChoice], promotionEngine.evaluateAll([main, invalidChoice], [rule]))).toBe('ADDON_PRODUCT_INVALID');
 });
});
