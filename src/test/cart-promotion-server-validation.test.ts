import { describe, expect, it } from 'vitest';
import { solvePromotionPlan } from '@/lib/promotion-plan-solver';
import { promotionEngine } from '@/lib/cart-promotions/engine';
import { buildUnifiedLegacyPromotionCandidates, enumerateLegacyAddonCandidates, enumerateLegacyGiftCandidates, canonicalLegacyRule, enumerateLegacyBundleCandidates, enumerateLegacyBuyNCandidates, enumerateLegacyStackCandidates, hasExceededSelectionAddonQuota, hasMisbrandedEligibleAddonMain, validateAddonPromotionLines, validatePromoMarks } from '@/lib/cart-promotions/service';
import type { AddonRuleConfig, CartLine, GiftRuleConfig, BundleRuleConfig, BuyNGetMRuleConfig, StackDiscountRuleConfig } from '@/lib/cart-promotions/types';
import { promotionLines, sampleAddonRule } from './cart-promotion-fixtures';
describe('canonical legacy rule evidence', () => {
 it('is stable across object key order and changes when the rule changes', () => {
  const a: StackDiscountRuleConfig = { id: 'x', type: 'stack-discount', enabled: true, name: 'X', description: '', terms: ['SKU'], discountRate: 0.5 };
  const b: StackDiscountRuleConfig = { discountRate: 0.5, terms: ['SKU'], description: '', name: 'X', enabled: true, type: 'stack-discount', id: 'x' };
  expect(canonicalLegacyRule(a)).toBe(canonicalLegacyRule(b));
  expect(canonicalLegacyRule(a)).not.toBe(canonicalLegacyRule({ ...b, discountRate: 0.6 }));
 });
});
describe('legacy stack promotion candidates', () => {
 it('enumerates whole-SKU alternatives with per-row legacy rounding', () => {
  const rule: StackDiscountRuleConfig = { id: 'stack', type: 'stack-discount', enabled: true, name: 'Stack', description: '', terms: ['SKU'], discountRate: 0.5 };
  const lines = [
   { id: 'a', productId: 'a', variantId: null, quantity: 2, unitPriceCents: 1, product: { id: 'a', brand: 'X', catalogNumber: 'SKU-A', name: 'A', price: 0.01 } },
   { id: 'b', productId: 'b', variantId: null, quantity: 1, unitPriceCents: 100, product: { id: 'b', brand: 'X', catalogNumber: 'SKU-B', name: 'B', price: 1 } },
  ];
  const candidates = enumerateLegacyStackCandidates(lines, rule);
  expect(candidates).toHaveLength(3);
  const both = candidates.find((candidate) => candidate.lines.length === 2)!;
  expect(both.lines.map((line) => line.totalAfterCents)).toEqual([1, 50]);
  expect(both.lines[0].priceBands).toEqual([{ unitCents: 1, quantity: 1, source: 'promotion', sourceLineId: 'a' }, { unitCents: 0, quantity: 1, source: 'promotion', sourceLineId: 'a' }]);
  expect(() => enumerateLegacyStackCandidates(lines, rule, 1)).toThrow('PROMOTION_ENUMERATION_LIMIT');
 });
});
describe('legacy buy-N promotion candidates', () => {
 it('preserves original freeCount>1 positions and complete qualification', () => {
  const rule: BuyNGetMRuleConfig = { id: 'buy', type: 'buy-n-get-m', enabled: true, name: 'Buy', description: '', terms: ['SKU'], groupSize: 3, freeCount: 2 };
  const lines = [
   { id: 'a', productId: 'a', variantId: null, quantity: 2, unitPriceCents: 200, product: { id: 'a', brand: 'X', catalogNumber: 'SKU-A', name: 'A', price: 2 } },
   { id: 'b', productId: 'b', variantId: null, quantity: 1, unitPriceCents: 100, product: { id: 'b', brand: 'X', catalogNumber: 'SKU-B', name: 'B', price: 1 } },
  ];
  const candidates = enumerateLegacyBuyNCandidates(lines, rule);
  expect(candidates).toHaveLength(1);
  expect(candidates[0].lines.map((line) => [line.role, line.totalAfterCents])).toEqual([['qualifier', 400], ['benefit', 0]]);
  expect(candidates[0].lines[1].priceBands).toEqual([{ unitCents: 0, quantity: 1, source: 'promotion', sourceLineId: 'b' }]);
  const marked = { ...lines[0], id: 'a-mark', quantity: 1, promoMark: { ruleId: 'other', price: 0 } };
  const mixed = enumerateLegacyBuyNCandidates([...lines, marked], rule)[0];
  expect(mixed.lines[0].role).toBe('qualifier');
  expect(mixed.lines[0].quantity).toBe(3);
  expect(mixed.lines[0].priceBands).toContainEqual({ unitCents: 200, quantity: 1, source: 'ordinary', sourceLineId: 'a-mark' });
 });
});
describe('legacy bundle promotion candidates', () => {
 it('counts overlapping groups independently and distributes one subtotal discount deterministically', () => {
  const rule: BundleRuleConfig = { id: 'bundle', type: 'bundle', enabled: true, name: 'Bundle', description: '', items: [
   { terms: ['SKU'], quantity: 1 }, { terms: ['SKU-A'], quantity: 1 },
  ], discountKind: 'fixed', discountValue: 0.01 };
  const lines = [
   { id: 'a', productId: 'a', variantId: null, quantity: 1, unitPriceCents: 100, product: { id: 'a', brand: 'X', catalogNumber: 'SKU-A', name: 'A', price: 1 } },
   { id: 'b', productId: 'b', variantId: null, quantity: 1, unitPriceCents: 100, product: { id: 'b', brand: 'X', catalogNumber: 'SKU-B', name: 'B', price: 1 } },
  ];
  const candidates = enumerateLegacyBundleCandidates(lines, rule);
  expect(candidates).toHaveLength(2);
  const both = candidates.find((candidate) => candidate.lines.length === 2)!;
  expect(both.lines.map((line) => line.totalAfterCents)).toEqual([99, 100]);
  expect(both.lines[0].priceBands?.[0].sourceLineId).toBe('a');
  const fiveCentLine = { ...lines[0], quantity: 5, unitPriceCents: 1, product: { ...lines[0].product, price: 0.01 } };
  const percentRule = { ...rule, items: [{ terms: ['SKU-A'], quantity: 1 }], discountKind: 'percent' as const, discountValue: 0.3 };
  expect(enumerateLegacyBundleCandidates([fiveCentLine], percentRule)[0].lines[0].totalAfterCents).toBe(2);
  const filtered = { ...lines[0], id: 'marked', promoMark: { ruleId: 'other', price: 0 } };
  const mixed = enumerateLegacyBundleCandidates([...lines, filtered], rule).find((candidate) => candidate.lines.length === 1)!;
  expect(mixed.lines[0].quantity).toBe(2);
  expect(mixed.lines[0].priceBands).toContainEqual({ unitCents: 100, quantity: 1, source: 'ordinary', sourceLineId: 'marked' });
 });
});
describe('legacy gift promotion candidates', () => {
 it('uses per-source specification quota and keeps the complete qualifying SKU', () => {
  const rule: GiftRuleConfig = { id: 'gift', type: 'gift', enabled: true, name: 'Gift', description: '',
   eligibleBrand: 'X', eligibleTerms: ['MAIN'], giftTerms: ['GIFT'], minQuantity: 1, specGifts: [{ spec: '1ml', minQuantity: 2, giftQuantity: 1 }] };
  const lines = [
   { id: 'm', productId: 'm', variantId: 'v', quantity: 2, unitPriceCents: 100, product: { id: 'm', variantId: 'v', brand: 'X', catalogNumber: 'MAIN', name: 'M', spec: '1 mL', price: 1 } },
   { id: 'g', productId: 'g', variantId: null, quantity: 1, unitPriceCents: 200, product: { id: 'g', brand: 'X', catalogNumber: 'GIFT', name: 'G', price: 2 }, promoMark: { ruleId: 'gift', price: 0 } },
  ];
  const candidates = enumerateLegacyGiftCandidates(lines, rule, new Date());
  expect(candidates).toHaveLength(1);
  expect(candidates[0].lines.map((line) => [line.productId, line.role, line.totalAfterCents])).toEqual([['g', 'benefit', 0], ['m', 'qualifier', 200]]);
  const unpriced = { ...lines[1], unitPriceCents: null, product: { ...lines[1].product, price: null } };
  const covered = enumerateLegacyGiftCandidates([lines[0], unpriced], rule, new Date())[0];
  expect(covered.lines.find((line) => line.productId === 'g')).toMatchObject({ totalAfterCents: 0, zeroPriceAuthorized: true });
  expect(enumerateLegacyGiftCandidates([lines[0], { ...unpriced, quantity: 2 }], rule, new Date())).toHaveLength(0);
 });
 it('keeps ordinary bands when same-product quota permits only part of a marked line', () => {
  const rule: GiftRuleConfig = { id: 'gift-same', type: 'gift', enabled: true, name: 'Gift', description: '', sameProduct: true, minQuantity: 1, giftTerms: ['SKU'] };
  const main = (id: string, cat: string) => ({ id, productId: id, variantId: null, quantity: 1, unitPriceCents: 100, product: { id, brand: 'X', catalogNumber: cat, name: cat, price: 1 } });
  const a = main('a', 'SKU-A'); const b = main('b', 'SKU-B');
  const gift = { ...a, id: 'gift-a', quantity: 2, promoMark: { ruleId: rule.id, price: 0 } };
  const candidate = enumerateLegacyGiftCandidates([a, b, gift], rule, new Date()).find((item) => item.lines.some((line) => line.productId === 'b'))!;
  expect(candidate.lines.find((line) => line.productId === 'a')?.priceBands).toContainEqual({ unitCents: 100, quantity: 1, source: 'ordinary', sourceLineId: 'gift-a' });
 });
});
describe('legacy selectable addon candidates', () => {
 it('prices two different option packs together after complete threshold qualification', () => {
  const rule: AddonRuleConfig = { ...sampleAddonRule, id: 'choices', eligibleBrand: 'X', addonBrand: 'X', eligibleTerms: ['MAIN'], minQuantity: 1,
   addonTerms: ['OPT'], addonOptions: [{ catalogNumber: 'OPT-A', price: 3, quantity: 2 }, { catalogNumber: 'OPT-B', price: 4, quantity: 1 }] };
  const main = { id: 'm', productId: 'm', variantId: null, quantity: 2, unitPriceCents: 100, product: { id: 'm', brand: 'X', catalogNumber: 'MAIN', name: 'M', price: 1 } };
  const a = { id: 'a', productId: 'a', variantId: null, quantity: 2, unitPriceCents: 300, product: { id: 'a', brand: 'X', catalogNumber: 'OPT-A', name: 'A', price: 3 }, promoMark: { ruleId: 'choices', choice: 'OPT-A', price: 3 } };
  const b = { id: 'b', productId: 'b', variantId: null, quantity: 1, unitPriceCents: 600, product: { id: 'b', brand: 'X', catalogNumber: 'OPT-B', name: 'B', price: 6 }, promoMark: { ruleId: 'choices', choice: 'OPT-B', price: 4 } };
  const candidates = enumerateLegacyAddonCandidates([main, a, b], rule, new Date());
  const both = candidates.find((entry) => entry.lines.length === 3)!;
  expect(both.lines.map((line) => [line.productId, line.totalAfterCents])).toEqual([['a', 300], ['b', 400], ['m', 200]]);
  const invalid = { ...a, promoMark: { ruleId: 'choices', price: 3 } };
  expect(() => enumerateLegacyAddonCandidates([main, invalid], rule, new Date())).toThrow('ADDON_PRODUCT_INVALID');
  const tinyRule = { ...rule, addonOptions: [{ catalogNumber: 'OPT-A', price: 0.005, quantity: 2 }] };
  const tiny = { ...a, quantity: 4, unitPriceCents: 100, product: { ...a.product, price: 1 }, promoMark: { ruleId: 'choices', choice: 'OPT-A', price: 0.005 } };
  const tinyCandidate = enumerateLegacyAddonCandidates([main, tiny], tinyRule, new Date())[0];
  expect(tinyCandidate.lines.find((line) => line.productId === 'a')?.totalAfterCents).toBe(1);
  const unified = buildUnifiedLegacyPromotionCandidates([main, a, b], new Date(), [rule]);
  expect(unified.candidates.some((entry) => entry.lines.length === 3)).toBe(true);
  expect(unified.evidence[0].id).toBe('legacy-cart:choices');
  expect(() => buildUnifiedLegacyPromotionCandidates([main, invalid], new Date(), [rule])).toThrow();
  expect(() => buildUnifiedLegacyPromotionCandidates([main, { ...a, promoMark: { ...a.promoMark, ruleId: 'missing' } }], new Date(), [rule])).toThrow();
  const groupA = { ...rule, id: 'ga', sharedQuotaGroup: 'shared', addonOptions: [{ catalogNumber: 'OPT-A', price: 3, quantity: 2 }] };
  const groupB = { ...rule, id: 'gb', sharedQuotaGroup: 'shared', addonOptions: [{ catalogNumber: 'OPT-B', price: 4, quantity: 1 }] };
  const mainOne = { ...main, quantity: 1 }; const mainTwo = { ...mainOne, id: 'm2', productId: 'm2', product: { ...mainOne.product, id: 'm2' } };
  const selectedA = { ...a, promoMark: { ...a.promoMark, ruleId: 'ga' } }; const selectedB = { ...b, promoMark: { ...b.promoMark, ruleId: 'gb' } };
  const grouped = buildUnifiedLegacyPromotionCandidates([mainOne, mainTwo, selectedA, selectedB], new Date(), [groupA, groupB]);
  const solution = solvePromotionPlan([mainOne, mainTwo, selectedA, selectedB].map((line) => ({ productId: line.productId, variantId: line.variantId, quantity: line.quantity, totalCents: line.quantity * line.unitPriceCents })), grouped.candidates);
  expect(solution.promotionIds.sort()).toEqual(['legacy-cart:ga', 'legacy-cart:gb']);
  const witnessed = grouped.candidates.find((entry) => entry.promotionId === 'legacy-cart:ga')!.sharedQuota!;
  expect(witnessed.groupId).toBe('shared');
  expect(witnessed.qualifiers.map((entry) => entry.quantity)).toEqual([1]);
  expect(witnessed.selections).toEqual([{ sourceLineId: 'a', productId: 'a', variantId: null, quantity: 2, perSelection: 2 }]);
  expect(() => buildUnifiedLegacyPromotionCandidates([mainOne, selectedA, selectedB], new Date(), [groupA, groupB])).toThrow();
  const autoA = { ...groupA, id: 'auto-a', addonOptions: undefined, addonTerms: ['OPT-A'], addonPrice: 1 };
  const autoB = { ...groupB, id: 'auto-b', addonOptions: undefined, addonTerms: ['OPT-B'], addonPrice: 2 };
  const rawA = { ...a, promoMark: null }; const rawB = { ...b, promoMark: null };
  const automatic = buildUnifiedLegacyPromotionCandidates([mainOne, mainTwo, rawA, rawB], new Date(), [autoA, autoB]);
  const autoPlan = solvePromotionPlan([mainOne, mainTwo, rawA, rawB].map((line) => ({ productId: line.productId, variantId: line.variantId, quantity: line.quantity, totalCents: line.quantity * line.unitPriceCents })), automatic.candidates);
  expect(autoPlan.promotionIds.sort()).toEqual(['legacy-cart:auto-a', 'legacy-cart:auto-b']);
  const noSavings = { ...autoA, id: 'baseline-a', addonPrice: 3 };
  const discount = { ...autoB, id: 'baseline-b', addonPrice: 2 };
  const markedNoSavings = { ...rawA, quantity: 1, promoMark: { ruleId: 'baseline-a', price: 3 } };
  const backgroundCart = [mainOne, markedNoSavings, rawB];
  const background = buildUnifiedLegacyPromotionCandidates(backgroundCart, new Date(), [noSavings, discount]);
  expect(background.candidates.some((candidate) => candidate.sharedQuota?.baselineSelections.some((entry) => entry.sourceLineId === 'a'))).toBe(true);
  const backgroundPlan = solvePromotionPlan(backgroundCart.map((line) => ({ productId: line.productId, variantId: line.variantId,
    quantity: line.quantity, totalCents: line.quantity * line.unitPriceCents })), background.candidates);
  expect(backgroundPlan.promotionIds).toHaveLength(0);
  expect(backgroundPlan.totalCents).toBe(1000);
  const repeated = { ...rawB, quantity: 2 };
  const sameBands = enumerateLegacyAddonCandidates([mainOne, repeated], discount, new Date(), 100000, true);
  const byPrice = sameBands.filter((candidate) => candidate.lines.find((line) => line.productId === 'b')?.totalAfterCents === 800);
  expect(byPrice.length).toBeGreaterThanOrEqual(2);
  expect(new Set(byPrice.map((candidate) => candidate.sharedQuota!.selections[0].quantity))).toEqual(new Set([1, 2]));
  expect(new Set(byPrice.map((candidate) => candidate.allocationId)).size).toBe(byPrice.length);


  const ruleX = { ...autoA, id: 'only-x', eligibleTerms: ['X'] };
  const ruleY = { ...autoB, id: 'only-y', eligibleTerms: ['Y'] };
  const x = { ...mainOne, product: { ...mainOne.product, catalogNumber: 'X' } };
  const y = { ...mainTwo, product: { ...mainTwo.product, catalogNumber: 'Y' } };
  const crossCart = [x, y, rawA, rawB];
  const crossCandidates = [...enumerateLegacyAddonCandidates(crossCart, ruleX, new Date(), 100000, true),
    ...enumerateLegacyAddonCandidates(crossCart, ruleY, new Date(), 100000, true)];
  const crossPlan = solvePromotionPlan(crossCart.map((line) => ({ productId: line.productId, variantId: line.variantId,
    quantity: line.quantity, totalCents: line.quantity * line.unitPriceCents })), crossCandidates);
  expect(crossPlan.promotionIds).toHaveLength(1);



 });
});
describe('per-source trusted prices for one SKU', () => {
 it('retains a member-priced qualifier and separately prices a marked base-price addon', () => {
  const rule: AddonRuleConfig = { ...sampleAddonRule, id: 'mixed-price', eligibleBrand: 'Sample', addonBrand: 'Sample', eligibleTerms: ['SKU'], addonTerms: ['SKU'], minQuantity: 1, addonPrice: 45 };
  const ordinary = { id: 'm', productId: 'p', variantId: null, quantity: 1, unitPriceCents: 8000, product: { id: 'p', brand: 'Sample', catalogNumber: 'SKU', name: 'P', price: 80, serverVerified: true } };
  const marked = { ...ordinary, id: 'a', unitPriceCents: 10000, product: { ...ordinary.product, price: 100 }, promoMark: { ruleId: 'mixed-price', price: 45 } };
  const result = buildUnifiedLegacyPromotionCandidates([ordinary, marked], new Date(), [rule]);
  const priced = result.candidates.find((candidate) => candidate.lines.some((line) => line.totalAfterCents === 12500))!;
  expect(priced.lines[0].priceBands).toEqual(expect.arrayContaining([
   { sourceLineId: 'm', quantity: 1, unitCents: 8000, source: 'ordinary' },
   { sourceLineId: 'a', quantity: 1, unitCents: 4500, source: 'promotion' },
  ]));
  const giftRule: GiftRuleConfig = { id: 'mixed-gift', type: 'gift', name: 'Gift', enabled: true, description: '',
   eligibleBrand: 'Sample', eligibleTerms: ['SKU'], giftTerms: ['SKU'], minQuantity: 1 };
  const unpricedGift = { ...ordinary, id: 'g', unitPriceCents: null, product: { ...ordinary.product, price: null }, promoMark: { ruleId: 'mixed-gift', price: 0 } };
  const giftCandidate = buildUnifiedLegacyPromotionCandidates([ordinary, unpricedGift], new Date(), [giftRule]).candidates[0];
  expect(giftCandidate.lines[0]).toMatchObject({ totalAfterCents: 8000, priceBands: expect.arrayContaining([
   { sourceLineId: 'm', quantity: 1, unitCents: 8000, source: 'ordinary' },
   { sourceLineId: 'g', quantity: 1, unitCents: 0, source: 'promotion' },
  ]) });
  expect(solvePromotionPlan([{ productId: 'p', variantId: null, quantity: 2, totalCents: null,
   ordinaryBands: [{ sourceLineId: 'm', quantity: 1, unitCents: 8000 }, { sourceLineId: 'g', quantity: 1, unitCents: null }] }], [giftCandidate]).totalCents).toBe(8000);


 });
});
describe('legacy ordinary addon shortfall', () => {
 it('keeps unqualified and excess items at their trusted ordinary price', () => {
  const rule: AddonRuleConfig = { ...sampleAddonRule, id: 'soft', minQuantity: 2, maxAddonsPerTrigger: 1 };
  const main = { id: 'm', productId: 'm', variantId: null, quantity: 1, unitPriceCents: 10000, product: { id: 'm', brand: 'Sample', catalogNumber: 'SAMPLE-MAIN', name: 'M', price: 100, serverVerified: true } };
  const addon = { id: 'a', productId: 'a', variantId: null, quantity: 2, unitPriceCents: 30000, product: { id: 'a', brand: 'Sample', catalogNumber: 'SAMPLE-ADDON', name: 'A', price: 300, serverVerified: true }, promoMark: { ruleId: 'soft', price: 50 } };
  expect(buildUnifiedLegacyPromotionCandidates([main, addon], new Date(), [rule]).candidates).toHaveLength(0);
  const qualified = buildUnifiedLegacyPromotionCandidates([{ ...main, quantity: 2 }, addon], new Date(), [rule]).candidates[0];
  expect(qualified.lines.find((line) => line.productId === 'a')?.priceBands).toEqual([
   { unitCents: 5000, quantity: 1, source: 'promotion', sourceLineId: 'a' },
   { unitCents: 30000, quantity: 1, source: 'ordinary', sourceLineId: 'a' },
  ]);
  const unpriced = { ...addon, unitPriceCents: null, product: { ...addon.product, price: null } };
  expect(() => buildUnifiedLegacyPromotionCandidates([main, unpriced], new Date(), [rule])).toThrow('UNIFIED_PROMO_MARK_INVALID');
 });
});
describe('generic server-side add-on validation', () => {
 it('does not impose static-rule work limits when no static rules are active, while rejecting unknown marks', () => {
  const line = { id: 'line', productId: 'p', variantId: null, quantity: 201, unitPriceCents: 100,
   product: { id: 'p', brand: 'Sample', catalogNumber: 'P', name: 'Sample', price: 1 } };
  expect(buildUnifiedLegacyPromotionCandidates([line], new Date()).candidates).toEqual([]);
  expect(() => buildUnifiedLegacyPromotionCandidates([{ ...line, promoMark: { ruleId: 'missing', price: 0 } }], new Date())).toThrow('UNIFIED_PROMO_MARK_INVALID');
 });
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
