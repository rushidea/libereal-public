import { expect, it } from 'vitest';
import { enumeratePromotionCandidates } from '@/lib/promotion-candidate-enumerator';
import { solvePromotionPlan } from '@/lib/promotion-plan-solver';
import type { BoundPromotion, PromotionPricingLine } from '@/data/promotion-calculation';
const now = new Date('2030-01-05T00:00:00.000Z');
const line = (id: string): PromotionPricingLine => ({ id, productId: id, variantId: null, quantity: 1, unitPriceCents: 10000, basePriceCents: 10000 });
const campaign = (id: string, price: number, products: string[]): BoundPromotion => ({ id, name: id, version: 1, status: 'active', startsAt: new Date('2030-01-01'), endsAt: new Date('2030-02-01'),
  definition: { schemaVersion: 1, template: 'direct-price', repeat: false, maxApplications: null, partialBenefit: true,
    groups: [{ key: 'main', role: 'benefit', unit: '件', quantity: 1 }], benefit: { kind: 'fixed-price', unitPriceCents: price } },
  bindings: products.map((productId) => ({ productId, variantId: null, groupKey: 'main' })) });
it('does not apply a database promotion to a marked source sharing the SKU', () => {
  const sources = [{ ...line('a'), sourceLineId: '0', databasePromotionEligible: true, unitPriceCents: 8000 },
    { ...line('a'), sourceLineId: '1', databasePromotionEligible: false }];
  const { cart, candidates } = enumeratePromotionCandidates(sources, [campaign('offer', 5000, ['a'])], now);
  const plan = solvePromotionPlan(cart, candidates);
  expect(plan.totalCents).toBe(15000);
  const selected = candidates.find((candidate) => candidate.allocationId === plan.allocationIds[0])!;
  expect(selected.lines[0].priceBands).toEqual(expect.arrayContaining([
    expect.objectContaining({ sourceLineId: '0', source: 'promotion', unitCents: 5000 }),
    expect.objectContaining({ sourceLineId: '1', source: 'ordinary', unitCents: 10000 }),
  ]));
});
it('applies the minimum only to the eligible source, keeping a marked source at its own price', () => {
  const sources = [{ ...line('a'), sourceLineId: '0', databasePromotionEligible: true, minimumUnitCents: 9000 },
    { ...line('a'), sourceLineId: '1', databasePromotionEligible: false, unitPriceCents: 7000 }];
  const { cart, candidates } = enumeratePromotionCandidates(sources, [campaign('offer', 5000, ['a'])], now);
  const plan = solvePromotionPlan(cart, candidates);
  expect(plan.totalCents).toBe(16000);
});
it('does not silently cover an unpriced marked source with an ordinary database promotion', () => {
  const sources = [{ ...line('a'), sourceLineId: '0', databasePromotionEligible: true },
    { ...line('a'), sourceLineId: '1', databasePromotionEligible: false, unitPriceCents: null, basePriceCents: null }];
  const result = enumeratePromotionCandidates(sources, [campaign('offer', 5000, ['a'])], now);
  expect(result.candidates).toHaveLength(0);
  expect(() => solvePromotionPlan(result.cart, result.candidates)).toThrow('PROMOTION_PRICE_COVERAGE_REQUIRED');
});
it('does not block catalog coverage because a legacy activity lacks an ordinary price', async () => {
  const { calculateUnifiedPromotionPricing } = await import('@/lib/unified-promotion-pricing');
  const legacy = campaign('legacy', 5000, ['a']);
  const catalog: BoundPromotion = { ...campaign('catalog', 0, ['a']), definition: {
    ...campaign('catalog', 0, ['a']).definition, priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 5000 },
  } };
  const source = { ...line('a'), sourceLineId: '0', unitPriceCents: null, basePriceCents: null, catalogReferenceCents: 10000 };
  expect(calculateUnifiedPromotionPricing([source], [legacy, catalog], now).totalCents).toBe(5000);
});
it('allows an exclusive activity whose other bound products are absent from the cart', async () => {
  const { calculateUnifiedPromotionPricing } = await import('@/lib/unified-promotion-pricing');
  const exclusive = { ...campaign('offer', 5000, ['a', 'b']), exclusive: true };
  expect(calculateUnifiedPromotionPricing([line('a')], [exclusive], now).totalCents).toBe(5000);
});
it('never multiplies separate activities on the same SKU', async () => {
  const { calculateUnifiedPromotionPricing } = await import('@/lib/unified-promotion-pricing');
  const first = campaign('first', 5000, ['a']);
  const second = campaign('second', 4000, ['a']);
  const result = calculateUnifiedPromotionPricing([line('a')], [first, second], now);
  expect(result.totalCents).toBe(4000);
  expect(result.promotionIds).toEqual(['second']);
});
it('distributes a group target across source minimums without increasing the group total', async () => {
  const { calculateUnifiedPromotionPricing } = await import('@/lib/unified-promotion-pricing');
  const group: BoundPromotion = { ...campaign('bundle', 0, ['a', 'b']), definition: {
    schemaVersion: 1, template: 'bundle', repeat: false, maxApplications: null, partialBenefit: false,
    groups: [{ key: 'main', role: 'qualifier-and-benefit', unit: 'item', quantity: 2 }],
    benefit: { kind: 'group-price', groupPriceCents: 10000 },
  } };
  const sources = [{ ...line('a'), sourceLineId: '0', minimumUnitCents: 9000 }, { ...line('b'), sourceLineId: '1' }];
  const result = calculateUnifiedPromotionPricing(sources, [group], now);
  expect(result.totalCents).toBe(10000);
  expect(result.lines.find((entry) => entry.productId === 'a')!.totalAfterCents).toBeGreaterThanOrEqual(9000);
  const impossible = [{ ...sources[0], minimumUnitCents: 9000 }, { ...sources[1], minimumUnitCents: 2000 }];
  expect(calculateUnifiedPromotionPricing(impossible, [group], now).totalCents).toBe(20000);
});
it('enumerates alternative SKU choices so another activity can win the contested SKU', () => {
  const { cart, candidates } = enumeratePromotionCandidates([line('a'), line('b')], [campaign('one-of-two', 5000, ['a', 'b']), campaign('a-only', 1000, ['a'])], now);
  const plan = solvePromotionPlan(cart, candidates);
  expect(plan.totalCents).toBe(6000);
  expect(plan.promotionIds).toEqual(['a-only', 'one-of-two']);
});
it('does not return a truncated candidate set when the enumeration budget is exhausted', () => {
  expect(() => enumeratePromotionCandidates([line('a'), line('b')], [campaign('one-of-two', 5000, ['a', 'b'])], now, 1)).toThrow('PROMOTION_ENUMERATION_LIMIT');
});
it('rejects different trusted prices for duplicate identities', () => {
  expect(() => enumeratePromotionCandidates([line('a'), { ...line('a'), unitPriceCents: 999 }], [], now)).toThrow('PROMOTION_SKU_PRICE_MISMATCH');
});
it('keeps buy-n priced units reserved when choosing another activity', () => {
  const buyN: BoundPromotion = { ...campaign('buy-n', 0, ['a', 'b', 'c']), definition: {
    schemaVersion: 1, template: 'buy-n-get-m', repeat: true, maxApplications: 1, partialBenefit: true, freeQuantity: 1,
    groups: [{ key: 'main', role: 'qualifier-and-benefit', unit: '件', quantity: 2 }], benefit: { kind: 'gift' },
  } };
  const cartLines = [line('a'), { ...line('b'), unitPriceCents: 5000, basePriceCents: 5000 }, { ...line('c'), unitPriceCents: 1000, basePriceCents: 1000 }];
  const evaluated = enumeratePromotionCandidates(cartLines, [buyN, campaign('a-only', 1000, ['a'])], now);
  const plan = solvePromotionPlan(evaluated.cart, evaluated.candidates);
  expect(plan.totalCents).toBe(6000);
  expect(plan.promotionIds).toEqual(['a-only', 'buy-n']);
});
it('the shared coordinator returns the exact chosen line assignments', async () => {
  const { calculateUnifiedPromotionPricing } = await import('@/lib/unified-promotion-pricing');
  const result = calculateUnifiedPromotionPricing([line('a'), line('b')], [campaign('one-of-two', 5000, ['a', 'b']), campaign('a-only', 1000, ['a'])], now);
  expect(result.totalCents).toBe(6000);
  expect(result.lines.map(({ productId, promotionId, totalAfterCents }) => ({ productId, promotionId, totalAfterCents }))).toEqual([
    { productId: 'a', promotionId: 'a-only', totalAfterCents: 1000 }, { productId: 'b', promotionId: 'one-of-two', totalAfterCents: 5000 },
  ]);
});
it('does not exhaust the budget for a simple one-unit direct offer across many SKUs', () => {
  const ids = Array.from({ length: 8 }, (_, index) => `p${index}`);
  const result = enumeratePromotionCandidates(ids.map(line), [campaign('single', 5000, ids)], now, 1000);
  expect(result.candidates).toHaveLength(8);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(75000);
});
it('requires a trusted catalog reference for a catalog-basis candidate', () => {
  const original = campaign('catalog', 5000, ['a']);
  const catalog: BoundPromotion = { ...original, definition: { ...original.definition, priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 6000 } } };
  expect(() => enumeratePromotionCandidates([line('a')], [catalog], now)).toThrow('PROMOTION_CATALOG_PRICE_REQUIRED');
  expect(enumeratePromotionCandidates([line('unrelated')], [catalog], now).candidates).toEqual([]);
});
it('keeps fully covered catalog alternatives when another bound benefit SKU lacks catalog price', () => {
  const original = campaign('catalog-alternatives', 0, ['a', 'b']);
  const catalog: BoundPromotion = { ...original, definition: { ...original.definition,
    priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 5000 } } };
  const result = enumeratePromotionCandidates([line('a'), { ...line('b'), catalogReferenceCents: 8000 }], [catalog], now);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].lines.map((entry) => entry.productId)).toEqual(['b']);
});
it('allocates group price without letting a line exceed its original amount', () => {
  const bundle: BoundPromotion = { ...campaign('group', 0, ['a', 'b', 'c']), definition: {
    schemaVersion: 1, template: 'bundle', repeat: true, maxApplications: 1, partialBenefit: false,
    groups: [{ key: 'main', role: 'qualifier-and-benefit', unit: '件', quantity: 3 }], benefit: { kind: 'group-price', groupPriceCents: 2 },
  } };
  const lines = ['a', 'b', 'c'].map((id) => ({ ...line(id), unitPriceCents: 1, basePriceCents: 1 }));
  const evaluated = enumeratePromotionCandidates(lines, [bundle], now);
  expect(solvePromotionPlan(evaluated.cart, evaluated.candidates).totalCents).toBe(2);
});
it('uses exact integer percentage rounding for large valid cent amounts', () => {
  const base = 9007199254740000;
  const promo: BoundPromotion = { ...campaign('percentage', 0, ['a']), definition: {
    ...campaign('percentage', 0, ['a']).definition, benefit: { kind: 'percentage', basisPoints: 3333 },
  } };
  const evaluated = enumeratePromotionCandidates([{ ...line('a'), unitPriceCents: base, basePriceCents: base }], [promo], now);
  const expected = Number((BigInt(base) * BigInt(3333) + BigInt(5000)) / BigInt(10000));
  expect(solvePromotionPlan(evaluated.cart, evaluated.candidates).totalCents).toBe(expected);
});
it('prevalidates a large binding set once for a simple one-unit direct offer', () => {
  const ids = Array.from({ length: 2000 }, (_, index) => `p${index}`);
  const result = enumeratePromotionCandidates(ids.slice(0, 100).map(line), [campaign('single-large', 5000, ids)], now, 5000);
  expect(result.candidates).toHaveLength(100);
});
it('handles a non-overlapping unlimited direct offer without enumerating every subset', () => {
  const ids = Array.from({ length: 100 }, (_, index) => `p${index}`);
  const original = campaign('all', 5000, ids);
  const unlimited: BoundPromotion = { ...original, definition: { ...original.definition, repeat: true, benefit: { kind: 'percentage', basisPoints: 5000 } } };
  const result = enumeratePromotionCandidates(ids.map(line), [unlimited], now, 5000);
  expect(result.candidates).toHaveLength(1);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(500000);
});
it('does not treat group price as independently monotone across SKUs', () => {
  const original = campaign('group-direct', 0, ['a', 'b']);
  const group: BoundPromotion = { ...original, definition: { ...original.definition, repeat: true, partialBenefit: false,
    benefit: { kind: 'group-price', groupPriceCents: 50 } } };
  const lines = [{ ...line('a'), unitPriceCents: 1, basePriceCents: 1 }, { ...line('b'), unitPriceCents: 100, basePriceCents: 100 }];
  const result = enumeratePromotionCandidates(lines, [group], now);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(51);
});
it('rejects unsafe aggregate quantities before closed-form direct pricing', () => {
  const original = campaign('all', 50, ['a', 'b']);
  const unlimited: BoundPromotion = { ...original, definition: { ...original.definition, repeat: true, benefit: { kind: 'percentage', basisPoints: 5000 } } };
  const lines = [{ ...line('a'), quantity: Number.MAX_SAFE_INTEGER, unitPriceCents: 1, basePriceCents: 1 },
    { ...line('b'), quantity: 2, unitPriceCents: 100, basePriceCents: 100 }];
  expect(() => enumeratePromotionCandidates(lines, [unlimited], now)).toThrow('INVALID_PROMOTION_AMOUNT');
});
it('uses a trusted catalog price to cover an otherwise unpriced SKU without pretending its ordinary price is zero', () => {
  const original = campaign('catalog', 5000, ['a']);
  const catalog: BoundPromotion = { ...original, definition: { ...original.definition, priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 6000 } } };
  const absent = { ...line('a'), unitPriceCents: null, basePriceCents: null, catalogReferenceCents: 10000 };
  const result = enumeratePromotionCandidates([absent], [catalog], now);
  expect(result.cart[0].totalCents).toBeNull();
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(6000);
  expect(() => solvePromotionPlan(enumeratePromotionCandidates([absent], [], now).cart, [])).toThrow('PROMOTION_PRICE_COVERAGE_REQUIRED');
  const partial = enumeratePromotionCandidates([{ ...absent, quantity: 2 }], [catalog], now);
  expect(() => solvePromotionPlan(partial.cart, partial.candidates)).toThrow('PROMOTION_PRICE_COVERAGE_REQUIRED');
});
it('respects catalog direct-price group quantity and repeat application caps', () => {
  const original = campaign('catalog-quantity', 0, ['a']);
  const catalog: BoundPromotion = { ...original, definition: { ...original.definition,
    repeat: true, maxApplications: 2, partialBenefit: false,
    groups: [{ key: 'main', role: 'benefit', unit: '件', quantity: 2 }],
    priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 5000 } } };
  const result = enumeratePromotionCandidates([{ ...line('a'), quantity: 5, catalogReferenceCents: 8000 }], [catalog], now);
  expect(result.candidates.map((candidate) => candidate.lines[0].totalAfterCents)).toEqual([38000, 26000]);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(26000);
});
it('requires complete ordinary-price coverage when a catalog allocation cannot cover all units', () => {
  const original = campaign('catalog-capped', 0, ['a']);
  const catalog: BoundPromotion = { ...original, definition: { ...original.definition,
    repeat: true, maxApplications: 1, partialBenefit: true,
    groups: [{ key: 'main', role: 'benefit', unit: '件', quantity: 2 }],
    priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 5000 } } };
  const absent = { ...line('a'), quantity: 3, unitPriceCents: null, basePriceCents: null, catalogReferenceCents: 8000 };
  const result = enumeratePromotionCandidates([absent], [catalog], now);
  expect(result.candidates).toEqual([]);
  expect(() => solvePromotionPlan(result.cart, result.candidates)).toThrow('PROMOTION_PRICE_COVERAGE_REQUIRED');
});
it('enumerates complete catalog bundle qualification and prices only the benefit group from catalog', () => {
  const original = campaign('catalog-bundle', 0, ['a', 'b']);
  const catalog: BoundPromotion = { ...original, definition: { ...original.definition,
    template: 'bundle', priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 5000 },
    groups: [{ key: 'qualifier', role: 'qualifier', unit: '件', quantity: 2 },
      { key: 'main', role: 'benefit', unit: '件', quantity: 1 }] },
    bindings: [{ productId: 'a', variantId: null, groupKey: 'qualifier' }, { productId: 'b', variantId: null, groupKey: 'qualifier' },
      { productId: 'c', variantId: null, groupKey: 'main' }] };
  const lines = [line('a'), line('b'), { ...line('c'), catalogReferenceCents: 10000 }];
  const result = enumeratePromotionCandidates(lines, [catalog], now);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].lines.map(({ productId, totalAfterCents }) => [productId, totalAfterCents])).toEqual([
    ['a', 10000], ['b', 10000], ['c', 5000],
  ]);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(25000);
  const incomplete = enumeratePromotionCandidates([line('a'), { ...line('c'), catalogReferenceCents: 10000 }], [catalog], now);
  expect(incomplete.candidates).toEqual([]);
});
it('applies catalog bundle repeat and maxApplications limits using complete group quantities', () => {
  const original = campaign('catalog-repeat-bundle', 0, ['a', 'b']);
  const catalog: BoundPromotion = { ...original, definition: { ...original.definition,
    template: 'bundle', repeat: true, maxApplications: 1, partialBenefit: false, priceBasis: 'catalog',
    benefit: { kind: 'percentage', basisPoints: 5000 },
    groups: [{ key: 'qualifier', role: 'qualifier', unit: '件', quantity: 2 },
      { key: 'main', role: 'benefit', unit: '件', quantity: 2 }] },
    bindings: [{ productId: 'a', variantId: null, groupKey: 'qualifier' }, { productId: 'b', variantId: null, groupKey: 'main' }] };
  const result = enumeratePromotionCandidates([
    { ...line('a'), quantity: 4 }, { ...line('b'), quantity: 3, catalogReferenceCents: 10000 },
  ], [catalog], now);
  const plan = solvePromotionPlan(result.cart, result.candidates);
  expect(plan.totalCents).toBe(60000);
  expect(result.candidates.some((candidate) => candidate.lines.some((entry) => entry.productId === 'b' && entry.totalAfterCents === 20000))).toBe(true);
});
it('qualifies a catalog bundle whose single group is both qualifier and benefit', () => {
  const original = campaign('catalog-qab', 0, ['a']);
  const catalog: BoundPromotion = { ...original, definition: { ...original.definition,
    template: 'bundle', repeat: true, maxApplications: 1, partialBenefit: false, priceBasis: 'catalog',
    benefit: { kind: 'percentage', basisPoints: 5000 },
    groups: [{ key: 'main', role: 'qualifier-and-benefit', unit: '件', quantity: 2 }] } };
  const result = enumeratePromotionCandidates([{ ...line('a'), quantity: 2, catalogReferenceCents: 8000 }], [catalog], now);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].lines[0].totalAfterCents).toBe(8000);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(8000);
});
it('applies a trusted per-unit minimum to catalog percentage benefit prices', () => {
  const original = campaign('catalog-floor', 0, ['a']);
  const catalog: BoundPromotion = { ...original, definition: { ...original.definition,
    repeat: true, priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 5000 } } };
  const result = enumeratePromotionCandidates([{ ...line('a'), quantity: 2, catalogReferenceCents: 8000, minimumUnitCents: 6000 }], [catalog], now);
  expect(result.candidates.some((candidate) => candidate.lines[0].totalAfterCents === 12000)).toBe(true);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(12000);
});
it('applies a trusted per-unit minimum to legacy direct-price allocations', () => {
  const original = campaign('legacy-floor', 5000, ['a']);
  const direct: BoundPromotion = { ...original, definition: { ...original.definition,
    repeat: true, benefit: { kind: 'fixed-price', unitPriceCents: 5000 } } };
  const result = enumeratePromotionCandidates([{ ...line('a'), quantity: 2, minimumUnitCents: 6000 }], [direct], now);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].lines[0].totalAfterCents).toBe(12000);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(12000);
});
it('keeps cheaper ordinary prices on non-floor SKUs in a floored direct campaign', () => {
  const original = campaign('legacy-mixed-floor', 500, ['a', 'b']);
  const direct: BoundPromotion = { ...original, definition: { ...original.definition,
    repeat: true, benefit: { kind: 'fixed-price', unitPriceCents: 500 } } };
  const result = enumeratePromotionCandidates([
    { ...line('a'), unitPriceCents: 100, basePriceCents: 1000 },
    { ...line('b'), minimumUnitCents: 600 },
  ], [direct], now);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].lines.map(({ productId, totalAfterCents }) => [productId, totalAfterCents])).toEqual([
    ['a', 100], ['b', 600],
  ]);
  expect(result.candidates[0].lines.map(({ productId, priceBands }) => [productId, priceBands])).toEqual([
    ['a', [{ unitCents: 100, quantity: 1, source: 'ordinary' }]],
    ['b', [{ unitCents: 600, quantity: 1, source: 'promotion' }]],
  ]);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(700);
});
it('uses per-SKU legacy reference-price overrides after multiplying before cent rounding', () => {
  const original = campaign('legacy-reference', 0, ['a', 'b']);
  const legacy: BoundPromotion = { ...original, definition: { ...original.definition,
    repeat: true, benefit: { kind: 'percentage', basisPoints: 5000 } } };
  const result = enumeratePromotionCandidates([
    { ...line('a'), unitPriceCents: 51, basePriceCents: 101, legacyPromotionUnitPriceOverridesCents: { 'legacy-reference': 50 } },
    { ...line('b'), unitPriceCents: 201, basePriceCents: 201, legacyPromotionUnitPriceOverridesCents: { 'legacy-reference': 100 } },
  ], [legacy], now);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].lines.map(({ productId, totalAfterCents, priceBands }) => [productId, totalAfterCents, priceBands])).toEqual([
    ['a', 50, [{ unitCents: 50, quantity: 1, source: 'promotion' }]],
    ['b', 100, [{ unitCents: 100, quantity: 1, source: 'promotion' }]],
  ]);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(150);
});
it('fails closed when a legacy reference activity lacks a per-SKU price override', () => {
  const original = campaign('legacy-reference', 0, ['a', 'b']);
  const legacy: BoundPromotion = { ...original, definition: { ...original.definition,
    repeat: true, benefit: { kind: 'percentage', basisPoints: 5000 } } };
  expect(() => enumeratePromotionCandidates([
    { ...line('a'), legacyPromotionUnitPriceOverridesCents: { 'legacy-reference': 50 } }, line('b'),
  ], [legacy], now)).toThrow('PROMOTION_LEGACY_PRICE_OVERRIDE_REQUIRED');
});
it('rejects an infeasible group-price allocation and retains the ordinary plan', () => {
  const original = campaign('unsupported-floor', 0, ['a', 'b']);
  const bundle: BoundPromotion = { ...original, definition: { ...original.definition,
    template: 'bundle', partialBenefit: false, benefit: { kind: 'group-price', groupPriceCents: 1000 },
    groups: [{ key: 'qualifier', role: 'qualifier', unit: '件', quantity: 1 },
      { key: 'main', role: 'benefit', unit: '件', quantity: 2 }] },
    bindings: [{ productId: 'a', variantId: null, groupKey: 'qualifier' }, { productId: 'b', variantId: null, groupKey: 'main' }] };
  const result = enumeratePromotionCandidates([
    line('a'), { ...line('b'), quantity: 2, unitPriceCents: 1000, basePriceCents: 1000, minimumUnitCents: 700 },
  ], [bundle], now);
  expect(result.candidates).toHaveLength(0);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(12000);
});
it('preserves group-price cent remainders as distinct per-unit bands', () => {
  const original = campaign('group-bands', 0, ['a', 'b']);
  const bundle: BoundPromotion = { ...original, definition: { ...original.definition,
    template: 'bundle', partialBenefit: false, benefit: { kind: 'group-price', groupPriceCents: 1001 },
    groups: [{ key: 'qualifier', role: 'qualifier', unit: '件', quantity: 1 },
      { key: 'main', role: 'benefit', unit: '件', quantity: 2 }] },
    bindings: [{ productId: 'a', variantId: null, groupKey: 'qualifier' }, { productId: 'b', variantId: null, groupKey: 'main' }] };
  const result = enumeratePromotionCandidates([
    line('a'), { ...line('b'), quantity: 2, unitPriceCents: 1000, basePriceCents: 1000 },
  ], [bundle], now);
  const benefitLine = result.candidates[0].lines.find((entry) => entry.productId === 'b')!;
  expect(benefitLine.priceBands).toEqual([
    { unitCents: 501, quantity: 1, source: 'promotion' },
    { unitCents: 500, quantity: 1, source: 'promotion' },
  ]);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(11001);
});
it('floors only the free units in a same-SKU gift package', () => {
  const original = campaign('gift-floor', 0, ['a']);
  const gift: BoundPromotion = { ...original, definition: { ...original.definition,
    template: 'same-sku-gift', repeat: false, freeQuantity: 1, benefit: { kind: 'gift' },
    groups: [{ key: 'main', role: 'qualifier-and-benefit', unit: '件', quantity: 2 }] } };
  const result = enumeratePromotionCandidates([{ ...line('a'), quantity: 2, minimumUnitCents: 6000 }], [gift], now);
  expect(result.candidates[0].lines[0].totalAfterCents).toBe(16000);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(16000);
});
it('deduplicates catalog quantity assignments with the same actual unit prices and sources', () => {
  const original = campaign('catalog', 0, ['a']);
  const catalog: BoundPromotion = { ...original, definition: { ...original.definition, repeat: true, priceBasis: 'catalog', benefit: { kind: 'percentage', basisPoints: 5000 } } };
  const result = enumeratePromotionCandidates([{ ...line('a'), quantity: 2, unitPriceCents: 100, basePriceCents: 100, catalogReferenceCents: 200 }], [catalog], now);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0].lines[0].priceBands).toEqual([{ unitCents: 100, quantity: 2, source: 'ordinary' }]);
  expect(solvePromotionPlan(result.cart, result.candidates).totalCents).toBe(200);
});
