import { expect, it } from 'vitest';
import { solvePromotionPlan } from '@/lib/promotion-plan-solver';
import type { QualifiedPlanCandidate, SharedQuotaWitness } from '@/lib/promotion-plan-solver';
const cart = [{ productId: 'A', variantId: null, quantity: 1, totalCents: 10000 }, { productId: 'B', variantId: null, quantity: 1, totalCents: 10000 }];
const claim = (productId: string, totalAfterCents: number) => ({ productId, variantId: null, quantity: 1, totalAfterCents });
it('validates ordinary price bands against each trusted source without averaging', () => {
  const mixed = [{ productId: 'A', variantId: null, quantity: 2, totalCents: 18000, ordinaryBands: [
    { sourceLineId: '0', quantity: 1, unitCents: 8000 }, { sourceLineId: '1', quantity: 1, unitCents: 10000 },
  ] }];
  const candidate: QualifiedPlanCandidate = { promotionId: 'p', qualified: true, lines: [{ productId: 'A', variantId: null, quantity: 2,
    totalAfterCents: 13000, priceBands: [{ sourceLineId: '0', quantity: 1, unitCents: 8000, source: 'ordinary' },
      { sourceLineId: '1', quantity: 1, unitCents: 5000, source: 'promotion' }] }] };
  expect(solvePromotionPlan(mixed, [candidate]).totalCents).toBe(13000);
  const forged = structuredClone(candidate);
  forged.lines[0].priceBands![0].unitCents = 7000;
  expect(() => solvePromotionPlan(mixed, [forged])).toThrow('INVALID_PROMOTION_CANDIDATE');
  const duplicate = structuredClone(candidate);
  duplicate.lines[0].priceBands![1].sourceLineId = '0';
  expect(() => solvePromotionPlan(mixed, [duplicate])).toThrow('INVALID_PROMOTION_CANDIDATE');
});
it('requires every unpriced source to be covered while preserving priced sources', () => {
  const mixed = [{ productId: 'A', variantId: null, quantity: 2, totalCents: null, ordinaryBands: [
    { sourceLineId: '0', quantity: 1, unitCents: 8000 }, { sourceLineId: '1', quantity: 1, unitCents: null },
  ] }];
  const candidate: QualifiedPlanCandidate = { promotionId: 'p', qualified: true, lines: [{ productId: 'A', variantId: null,
    quantity: 2, totalAfterCents: 13000, priceBands: [
      { sourceLineId: '0', quantity: 1, unitCents: 8000, source: 'ordinary' },
      { sourceLineId: '1', quantity: 1, unitCents: 5000, source: 'promotion' },
    ] }] };
  expect(solvePromotionPlan(mixed, [candidate]).totalCents).toBe(13000);
  const unpricedOrdinary = structuredClone(candidate);
  unpricedOrdinary.lines[0].priceBands![1].source = 'ordinary';
  expect(() => solvePromotionPlan(mixed, [unpricedOrdinary])).toThrow('INVALID_PROMOTION_CANDIDATE');
  const unapprovedFree = structuredClone(candidate);
  unapprovedFree.lines[0].priceBands![1].unitCents = 0;
  unapprovedFree.lines[0].totalAfterCents = 8000;
  expect(() => solvePromotionPlan(mixed, [unapprovedFree])).toThrow('INVALID_PROMOTION_CANDIDATE');
  expect(() => solvePromotionPlan(mixed, [])).toThrow('PROMOTION_PRICE_COVERAGE_REQUIRED');
});
it('selects the cheapest complete plan without splitting a qualifying bundle', () => {
  const candidates = [{ promotionId: 'bundle', qualified: true, lines: [claim('A', 4000), claim('B', 9000)] },
    { promotionId: 'single-a', qualified: true, lines: [claim('A', 5000)] }, { promotionId: 'single-b', qualified: true, lines: [claim('B', 5000)] }];
  expect(solvePromotionPlan(cart, candidates)).toEqual({ totalCents: 10000, promotionIds: ['single-a', 'single-b'], allocationIds: ['single-a', 'single-b'] });
});
it('never awards an unqualified candidate and keeps deterministic ties', () => {
  const candidates = [{ promotionId: 'b', qualified: true, lines: [claim('A', 5000)] },
    { promotionId: 'a', qualified: true, lines: [claim('A', 5000)] }, { promotionId: 'invalid', qualified: false, lines: [claim('B', 0)] }];
  expect(solvePromotionPlan(cart, candidates)).toEqual({ totalCents: 15000, promotionIds: ['a'], allocationIds: ['a'] });
  expect(solvePromotionPlan(cart, [...candidates].reverse())).toEqual(solvePromotionPlan(cart, candidates));
});
it('compares alternative whole allocations of one promotion but never selects it twice', () => {
  const candidates = [{ promotionId: 'bundle', allocationId: 'a-only', qualified: true, lines: [claim('A', 4000)] },
    { promotionId: 'bundle', allocationId: 'b-only', qualified: true, lines: [claim('B', 3000)] }];
  expect(solvePromotionPlan(cart, candidates)).toEqual({ totalCents: 13000, promotionIds: ['bundle'], allocationIds: ['b-only'] });
});
it('fails explicitly on solver budget exhaustion', () => {
  expect(() => solvePromotionPlan(cart, [{ promotionId: 'a', qualified: true, lines: [claim('A', 5000)] }], 1)).toThrow('PROMOTION_SOLVER_LIMIT');
});
it('finds the cheapest valid plan when shared addon scopes differ', () => {
  const lines = ['X', 'Y', 'AX', 'AY'].map((productId) => ({ productId, variantId: null, quantity: 1, totalCents: 100 }));
  const witness = (main: string, addon: string): SharedQuotaWitness => ({ groupId: 'shared', ruleId: main,
    scope: { eligibleBrand: 'Synthetic', eligibleTerms: [main], eligibleExactTerms: [], eligibleNameIncludes: [],
      minQuantity: 1, selection: false, maxAddonsPerTrigger: 1 },
    qualifiers: [{ sourceLineId: main, productId: main, variantId: null, brand: 'Synthetic', catalogNumber: main, name: main, quantity: 1 }],
    selections: [{ sourceLineId: addon, productId: addon, variantId: null, quantity: 1, perSelection: 1 }], baselineSelections: [] });
  const candidates: QualifiedPlanCandidate[] = ['X', 'Y'].map((main) => ({ promotionId: main, qualified: true,
    sharedQuota: witness(main, `A${main}`), lines: [
      { productId: main, variantId: null, quantity: 1, role: 'qualifier' },
      { productId: `A${main}`, variantId: null, quantity: 1, totalAfterCents: main === 'X' ? 50 : 25 },
    ] }));
  expect(solvePromotionPlan(lines, candidates)).toMatchObject({ totalCents: 325, promotionIds: ['Y'] });
});
it('counts an undiscounted explicit shared-group mark before an automatic addon', () => {
  const lines = ['M', 'A', 'B'].map((productId) => ({ productId, variantId: null, quantity: 1, totalCents: 100 }));
  const candidate: QualifiedPlanCandidate = { promotionId: 'B', qualified: true,
    lines: [{ productId: 'M', variantId: null, quantity: 1, role: 'qualifier' }, { productId: 'B', variantId: null, quantity: 1, totalAfterCents: 50 }],
    sharedQuota: { groupId: 'shared', ruleId: 'B', scope: { eligibleBrand: 'Synthetic', eligibleTerms: ['M'], eligibleExactTerms: [],
      eligibleNameIncludes: [], minQuantity: 1, selection: false, maxAddonsPerTrigger: 1 },
    qualifiers: [{ sourceLineId: 'main', productId: 'M', variantId: null, brand: 'Synthetic', catalogNumber: 'M', name: 'M', quantity: 1 }],
    selections: [{ sourceLineId: 'automatic', productId: 'B', variantId: null, quantity: 1, perSelection: 1 }],
    baselineSelections: [{ sourceLineId: 'marked', productId: 'A', variantId: null, quantity: 1, perSelection: 1 }] } };
  expect(solvePromotionPlan(lines, [candidate])).toMatchObject({ totalCents: 300, promotionIds: [] });
});
it('rejects candidate quantity drift and duplicate SKU claims', () => {
  expect(() => solvePromotionPlan(cart, [{ promotionId: 'a', qualified: true, lines: [{ ...claim('A', 5000), quantity: 2 }] }])).toThrow('INVALID_PROMOTION_CANDIDATE');
  expect(() => solvePromotionPlan(cart, [{ promotionId: 'a', qualified: true, lines: [claim('A', 5000), claim('A', 5000)] }])).toThrow('INVALID_PROMOTION_CANDIDATE');
});
it('requires full coverage of missing ordinary prices and compares actual totals', () => {
  const missing = [{ ...cart[0], totalCents: null }, cart[1]];
  const candidates = [{ promotionId: 'bundle', qualified: true, lines: [claim('A', 6000), claim('B', 9000)] },
    { promotionId: 'a', qualified: true, lines: [claim('A', 8000)] },
    { promotionId: 'b', qualified: true, lines: [claim('B', 1000)] }];
  expect(solvePromotionPlan(missing, candidates)).toEqual({ totalCents: 9000, promotionIds: ['a', 'b'], allocationIds: ['a', 'b'] });
  expect(() => solvePromotionPlan(missing, [candidates[2]])).toThrow('PROMOTION_PRICE_COVERAGE_REQUIRED');
  expect(() => solvePromotionPlan(missing, [{ promotionId: 'free', qualified: true, lines: [claim('A', 0)] }])).toThrow('INVALID_PROMOTION_CANDIDATE');
  expect(solvePromotionPlan(missing, [{ promotionId: 'gift', qualified: true,
    lines: [{ ...claim('A', 0), zeroPriceAuthorized: true }] }]).totalCents).toBe(10000);
});
it('allows a higher-than-ordinary candidate when needed for an atomic bundle', () => {
  const missing = [cart[0], { ...cart[1], totalCents: null }];
  const candidates = [{ promotionId: 'bundle', qualified: true, lines: [claim('A', 11000), claim('B', 1000)] }];
  expect(solvePromotionPlan(missing, candidates).totalCents).toBe(12000);
});
it('validates the actual per-unit price bands instead of accepting a fabricated average', () => {
  const two = [{ ...cart[0], quantity: 2, totalCents: 20000 }];
  const bands = [{ unitCents: 10000, quantity: 1, source: 'ordinary' as const },
    { unitCents: 5000, quantity: 1, source: 'promotion' as const }];
  const candidate = { promotionId: 'offer', qualified: true, lines: [{ ...claim('A', 15000), quantity: 2, priceBands: bands }] };
  expect(solvePromotionPlan(two, [candidate]).totalCents).toBe(15000);
  expect(() => solvePromotionPlan(two, [{ ...candidate, lines: [{ ...candidate.lines[0], totalAfterCents: 14999 }] }])).toThrow('INVALID_PROMOTION_CANDIDATE');
  expect(() => solvePromotionPlan([{ ...two[0], totalCents: null }], [candidate])).toThrow('INVALID_PROMOTION_CANDIDATE');
});
it('preserves ordinary qualifier source bands and rejects repricing the qualifier', () => {
  const lines = [{ ...cart[0], quantity: 2, totalCents: 20000 }, cart[1]];
  const qualifier = { ...claim('A', 20000), quantity: 2, role: 'qualifier' as const, priceBands: [
    { unitCents: 10000, quantity: 1, source: 'ordinary' as const, sourceLineId: '0' },
    { unitCents: 10000, quantity: 1, source: 'ordinary' as const, sourceLineId: '1' },
  ] };
  const candidate = { promotionId: 'bundle', qualified: true, lines: [qualifier, claim('B', 5000)] };
  expect(solvePromotionPlan(lines, [candidate]).totalCents).toBe(25000);
  const bad = { ...qualifier, priceBands: [{ ...qualifier.priceBands[0], unitCents: 9000 }, { ...qualifier.priceBands[1], unitCents: 11000 }] };
  expect(() => solvePromotionPlan(lines, [{ ...candidate, lines: [bad, claim('B', 5000)] }])).toThrow('INVALID_PROMOTION_CANDIDATE');
});
it('matches exhaustive selection on bounded overlapping complete candidates', () => {
  const inputs = [{ promotionId: 'a', qualified: true, lines: [claim('A', 7000)] },
    { promotionId: 'b', qualified: true, lines: [claim('B', 5000)] },
    { promotionId: 'bundle', qualified: true, lines: [claim('A', 4000), claim('B', 9000)] }];
  const plan = solvePromotionPlan(cart, inputs);
  let best = 20000;
  for (let mask = 0; mask < 1 << inputs.length; mask++) {
    const chosen = inputs.filter((_, index) => (mask & (1 << index)) !== 0);
    const ids = chosen.flatMap((candidate) => candidate.lines.map((entry) => entry.productId));
    if (new Set(ids).size !== ids.length) continue;
    const savings = chosen.flatMap((candidate) => candidate.lines).reduce((sum, entry) => sum + 10000 - entry.totalAfterCents, 0);
    best = Math.min(best, 20000 - savings);
  }
  expect(plan.totalCents).toBe(best);
});
