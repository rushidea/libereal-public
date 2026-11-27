import { promotionSkuKey } from '@/data/promotion-foundation';

/** Null means there is no valid ordinary price; the SKU must be covered in full. */
export type PromotionPlanSource = { sourceLineId: string; quantity: number; unitCents: number | null };
export type PromotionPlanLine = { productId: string; variantId: string | null; quantity: number; totalCents: number | null; ordinaryBands?: PromotionPlanSource[] };
export type SharedQuotaWitness = {
  groupId: string; ruleId: string;
  scope: { eligibleBrand: string; eligibleTerms: string[]; eligibleExactTerms: string[]; eligibleNameIncludes: string[];
    minQuantity: number; selection: boolean; maxAddonsPerTrigger: number };
  qualifiers: Array<{ sourceLineId: string; productId: string; variantId: string | null; brand: string; catalogNumber: string; name: string; quantity: number }>;
  selections: Array<{ sourceLineId: string; productId: string; variantId: string | null; quantity: number; perSelection: number }>;
  baselineSelections: Array<{ sourceLineId: string; productId: string; variantId: string | null; quantity: number; perSelection: number }>;
};
export type AddonSelectionWitness = {
  ruleId: string;
  selections: Array<{ sourceLineId: string; productId: string; variantId: string | null; quantity: number; perSelection: number }>;
};
export type QualifiedPlanCandidate = {
  promotionId: string;
  allocationId?: string;
  conflictGroupId?: string;
  sharedQuota?: SharedQuotaWitness;
  addonSelection?: AddonSelectionWitness;
  qualified: boolean;
  /** SKU keys blocked from any other selected promotion, including qualifier use. */
  exclusiveKeys?: string[];
  /** A qualifier claim proves eligibility but does not consume or reprice that SKU. */
  lines: Array<{ productId: string; variantId: string | null; quantity: number; role?: 'benefit' | 'qualifier';
    totalAfterCents?: number; zeroPriceAuthorized?: boolean;
    priceBands?: Array<{ unitCents: number; quantity: number; source: 'ordinary' | 'promotion'; sourceLineId?: string }> }>;
};
export type PromotionPlan = { totalCents: number; promotionIds: string[]; allocationIds: string[] };

/** Exact bounded search over actual payable totals, never a fabricated missing-price baseline. */
export function solvePromotionPlan(cart: PromotionPlanLine[], candidates: QualifiedPlanCandidate[], maxNodes = 250000): PromotionPlan {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) throw new Error('INVALID_PROMOTION_SOLVER_BUDGET');
  if (cart.length > 200 || candidates.length > 200) throw new Error('PROMOTION_SOLVER_LIMIT');
  const originals = new Map<string, PromotionPlanLine>();
  for (const line of cart) {
    const key = promotionSkuKey(line);
    if (!line.productId || (line.variantId !== null && !line.variantId) || originals.has(key)
      || !Number.isSafeInteger(line.quantity) || line.quantity <= 0
      || (line.totalCents !== null && (!Number.isSafeInteger(line.totalCents) || line.totalCents <= 0))) throw new Error('INVALID_PROMOTION_PLAN_CART');
    if (line.ordinaryBands) {
      const ids = new Set<string>(); let count = 0; let total = BigInt(0); let missing = false;
      for (const band of line.ordinaryBands) {
        if (!band.sourceLineId || ids.has(band.sourceLineId) || !Number.isSafeInteger(band.quantity) || band.quantity <= 0
          || (band.unitCents !== null && (!Number.isSafeInteger(band.unitCents) || band.unitCents <= 0))) throw new Error('INVALID_PROMOTION_PLAN_CART');
        ids.add(band.sourceLineId); count += band.quantity;
        if (band.unitCents === null) missing = true; else total += BigInt(band.quantity) * BigInt(band.unitCents);
      }
      if (count !== line.quantity || total > BigInt(Number.MAX_SAFE_INTEGER)
        || (missing ? line.totalCents !== null : line.totalCents !== Number(total))) throw new Error('INVALID_PROMOTION_PLAN_CART');
    }
    originals.set(key, line);
  }
  const seenIds = new Set<string>();
  const eligible = candidates.filter((candidate) => candidate.qualified).map((candidate) => {
    const allocationId = candidate.allocationId ?? candidate.promotionId;
    const candidateKey = JSON.stringify([candidate.promotionId, allocationId]);
    if (!candidate.promotionId || !allocationId || seenIds.has(candidateKey) || !candidate.lines.length) throw new Error('INVALID_PROMOTION_CANDIDATE');
    seenIds.add(candidateKey);
    const claims = new Map<string, number>();
    const qualifiers = new Set<string>();
    for (const line of candidate.lines) {
      const key = promotionSkuKey(line); const original = originals.get(key);
      if (!original || claims.has(key) || qualifiers.has(key) || line.quantity !== original.quantity) throw new Error('INVALID_PROMOTION_CANDIDATE');
      const role = line.role ?? 'benefit';
      if (original.ordinaryBands && line.priceBands) {
        const sources = new Map(original.ordinaryBands.map((band) => [band.sourceLineId, band]));
        const remaining = new Map(original.ordinaryBands.map((band) => [band.sourceLineId, band.quantity]));
        for (const band of line.priceBands) {
          const source = band.sourceLineId ? sources.get(band.sourceLineId) : undefined;
          if (!source || !Number.isSafeInteger(band.quantity) || band.quantity <= 0
            || (band.source === 'ordinary' && (source.unitCents === null || source.unitCents !== band.unitCents))
            || (source.unitCents === null && band.unitCents === 0 && !line.zeroPriceAuthorized)) throw new Error('INVALID_PROMOTION_CANDIDATE');
          const left = (remaining.get(source.sourceLineId) ?? 0) - band.quantity;
          if (left < 0) throw new Error('INVALID_PROMOTION_CANDIDATE');
          remaining.set(source.sourceLineId, left);
        }
        if ([...remaining.values()].some((value) => value !== 0)) throw new Error('INVALID_PROMOTION_CANDIDATE');
      } else if (original.ordinaryBands) throw new Error('INVALID_PROMOTION_CANDIDATE');
      if (role === 'qualifier') {
        if (line.zeroPriceAuthorized || original.totalCents === null
          || (line.totalAfterCents !== undefined && line.totalAfterCents !== original.totalCents)) throw new Error('INVALID_PROMOTION_CANDIDATE');
        if (line.priceBands) {
          let quantity = 0; let total = BigInt(0);
          for (const band of line.priceBands) {
            if (band.source !== 'ordinary' || !Number.isSafeInteger(band.quantity) || band.quantity <= 0
              || !Number.isSafeInteger(band.unitCents) || band.unitCents < 0
              || (band.sourceLineId !== undefined && (typeof band.sourceLineId !== 'string' || band.sourceLineId.length > 80))
              || (!original.ordinaryBands && BigInt(band.unitCents) * BigInt(original.quantity) !== BigInt(original.totalCents))) throw new Error('INVALID_PROMOTION_CANDIDATE');
            quantity += band.quantity;
            if (!Number.isSafeInteger(quantity)) throw new Error('INVALID_PROMOTION_CANDIDATE');
            total += BigInt(band.unitCents) * BigInt(band.quantity);
          }
          if (quantity !== original.quantity || total !== BigInt(original.totalCents)) throw new Error('INVALID_PROMOTION_CANDIDATE');
        }
        qualifiers.add(key);
        claims.set(key, original.totalCents);
        continue;
      }
      if (!Number.isSafeInteger(line.totalAfterCents) || line.totalAfterCents! < 0
        || (original.totalCents === null && line.totalAfterCents === 0 && line.zeroPriceAuthorized !== true)) throw new Error('INVALID_PROMOTION_CANDIDATE');
      if (line.priceBands) {
        let quantity = 0; let total = BigInt(0);
        for (const band of line.priceBands) {
          if (!Number.isSafeInteger(band.quantity) || band.quantity <= 0 || !Number.isSafeInteger(band.unitCents) || band.unitCents < 0
            || (band.source !== 'ordinary' && band.source !== 'promotion')
            || (band.sourceLineId !== undefined && (typeof band.sourceLineId !== 'string' || band.sourceLineId.length > 80))
            || (original.totalCents === null && !original.ordinaryBands && band.source === 'ordinary')) throw new Error('INVALID_PROMOTION_CANDIDATE');
          quantity += band.quantity;
          if (!Number.isSafeInteger(quantity)) throw new Error('INVALID_PROMOTION_CANDIDATE');
          total += BigInt(band.quantity) * BigInt(band.unitCents);
        }
        if (quantity !== line.quantity || total !== BigInt(line.totalAfterCents!)) throw new Error('INVALID_PROMOTION_CANDIDATE');
      }
      claims.set(key, line.totalAfterCents!);
    }
    if (!claims.size) throw new Error('INVALID_PROMOTION_CANDIDATE');
    const exclusiveKeys = new Set(candidate.exclusiveKeys ?? []);
    if ([...exclusiveKeys].some((key) => !originals.has(key))) throw new Error('INVALID_PROMOTION_CANDIDATE');
    const selectedAddon = candidate.addonSelection;
    if (selectedAddon && (!selectedAddon.ruleId || selectedAddon.ruleId !== candidate.promotionId || !Array.isArray(selectedAddon.selections)
      || selectedAddon.selections.some((line) => !line.sourceLineId || !claims.has(promotionSkuKey(line))
        || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(line.perSelection) || line.perSelection < 1))) {
      throw new Error('INVALID_PROMOTION_CANDIDATE');
    }
    const quota = candidate.sharedQuota;
    if (quota) {
      const s = quota.scope;
      if (!quota.groupId || !quota.ruleId || typeof s.eligibleBrand !== 'string' || !Number.isSafeInteger(s.minQuantity) || s.minQuantity < 1
        || !Number.isSafeInteger(s.maxAddonsPerTrigger) || s.maxAddonsPerTrigger < 1 || typeof s.selection !== 'boolean'
        || ![s.eligibleTerms, s.eligibleExactTerms, s.eligibleNameIncludes].every((values) => Array.isArray(values) && values.every((value) => typeof value === 'string'))
        || [...quota.qualifiers, ...quota.selections].some((line) => !line.sourceLineId || !claims.has(promotionSkuKey(line))
          || !Number.isSafeInteger(line.quantity) || line.quantity <= 0)
        || quota.selections.some((line) => !Number.isSafeInteger(line.perSelection) || line.perSelection < 1)) throw new Error('INVALID_PROMOTION_CANDIDATE');
      if (!Array.isArray(quota.baselineSelections) || quota.baselineSelections.some((line) => !line.sourceLineId || !line.productId
        || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(line.perSelection) || line.perSelection < 1)) throw new Error('INVALID_PROMOTION_CANDIDATE');
    }
    return { id: candidate.promotionId, conflictGroupId: candidate.conflictGroupId ?? candidate.promotionId, sharedQuota: quota,
      allocationId, candidateKey, claims, qualifiers, exclusiveKeys };
  }).sort((a, b) => a.candidateKey < b.candidateKey ? -1 : a.candidateKey > b.candidateKey ? 1 : 0);
  if (eligible.length > 200) throw new Error('PROMOTION_SOLVER_LIMIT');
  // An optimistic per-SKU lower bound deliberately ignores overlaps and campaign
  // exclusivity. It can only underestimate a legal plan, so pruning stays exact.
  const suffix = new Array<Map<string, number>>(eligible.length + 1);
  suffix[eligible.length] = new Map();
  for (let i = eligible.length - 1; i >= 0; i--) {
    const current = new Map(suffix[i + 1]);
    for (const [key, value] of eligible[i].claims) current.set(key, Math.min(current.get(key) ?? value, value));
    suffix[i] = current;
  }
  let bestTotal: bigint | null = null; let best: string[] = []; let nodes = 0;
  const used = new Set<string>(); const usedPromotions = new Set<string>(); const usedConflictGroups = new Set<string>(); const chosen: string[] = [];
  const selectedKeyCounts = new Map<string, number>(); const selectedExclusiveCounts = new Map<string, number>();
  const addCounts = (counts: Map<string, number>, keys: Iterable<string>, delta: number) => {
    for (const key of keys) {
      const next = (counts.get(key) ?? 0) + delta;
      if (next <= 0) counts.delete(key); else counts.set(key, next);
    }
  };
  const lex = (a: string[], b: string[]) => {
    const common = Math.min(a.length, b.length);
    for (let i = 0; i < common; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return a.length - b.length;
  };
  const sharedQuotasValid = (): boolean => {
    const groups = new Map<string, SharedQuotaWitness[]>();
    for (const key of chosen) {
      const witness = eligible.find((entry) => entry.candidateKey === key)?.sharedQuota;
      if (witness) groups.set(witness.groupId, [...(groups.get(witness.groupId) ?? []), witness]);
    }
    for (const witnesses of groups.values()) {
      const qualifiers = witnesses.flatMap((witness) => witness.qualifiers);
      const baseline = witnesses[0].baselineSelections;
      if (witnesses.some((witness) => JSON.stringify(witness.baselineSelections) !== JSON.stringify(baseline))) return false;
      const selected = witnesses.flatMap((witness) => witness.selections);
      const baselineBySource = new Map(baseline.map((line) => [line.sourceLineId, line]));
      if (baselineBySource.size !== baseline.length) return false;
      for (const line of selected) {
        const fixed = baselineBySource.get(line.sourceLineId);
        if (fixed && (fixed.productId !== line.productId || fixed.variantId !== line.variantId
          || fixed.perSelection !== line.perSelection || line.quantity > fixed.quantity)) return false;
      }
      const selections = [...baseline, ...selected.filter((line) => !baselineBySource.has(line.sourceLineId))];
      if (new Set(qualifiers.map((line) => line.sourceLineId)).size !== qualifiers.length
        || new Set(selected.map((line) => line.sourceLineId)).size !== selected.length
        || new Set(selections.map((line) => line.sourceLineId)).size !== selections.length) return false;
      for (const { scope } of witnesses) {
        const count = qualifiers.filter((line) => line.brand === scope.eligibleBrand
          && (scope.eligibleTerms.some((term) => line.catalogNumber.startsWith(term))
            || scope.eligibleExactTerms.includes(line.catalogNumber)
            || (scope.eligibleNameIncludes.length > 0 && scope.eligibleNameIncludes.every((term) => line.name.toLowerCase().includes(term.toLowerCase())))))
          .reduce((sum, line) => sum + line.quantity, 0);
        const used = selections.reduce((sum, line) => sum + (scope.selection ? Math.ceil(line.quantity / line.perSelection) : line.quantity), 0);
        if (!Number.isSafeInteger(count) || !Number.isSafeInteger(used)
          || used > Math.floor(count / scope.minQuantity) * (scope.selection ? 1 : scope.maxAddonsPerTrigger)) return false;
      }
    }
    return true;
  };
  const visit = (index: number, assigned: bigint): void => {
    if (++nodes > maxNodes) throw new Error('PROMOTION_SOLVER_LIMIT');
    let lower = assigned;
    for (const [key, original] of originals) {
      if (used.has(key)) continue;
      const candidate = suffix[index].get(key);
      const fallback = original.totalCents;
      if (candidate === undefined && fallback === null) return;
      lower += BigInt(candidate === undefined ? fallback! : fallback === null ? candidate : Math.min(candidate, fallback));
    }
    if (bestTotal !== null && lower > bestTotal) return;
    if (index === eligible.length) {
      if (!sharedQuotasValid()) return;
      if (bestTotal === null || lower < bestTotal || (lower === bestTotal && lex(chosen, best) < 0)) { bestTotal = lower; best = [...chosen]; }
      return;
    }
    const candidate = eligible[index];
    const allCandidateKeys = new Set([...candidate.claims.keys(), ...candidate.qualifiers]);
    if (!usedPromotions.has(candidate.id) && !usedConflictGroups.has(candidate.conflictGroupId)
      && ![...candidate.claims.keys()].some((key) => used.has(key))
      && ![...allCandidateKeys].some((key) => selectedExclusiveCounts.has(key))
      && ![...candidate.exclusiveKeys].some((key) => selectedKeyCounts.has(key))) {
      let candidateTotal = BigInt(0);
      for (const [key, value] of candidate.claims) { used.add(key); candidateTotal += BigInt(value); }
      addCounts(selectedKeyCounts, allCandidateKeys, 1);
      addCounts(selectedExclusiveCounts, candidate.exclusiveKeys, 1);
      usedConflictGroups.add(candidate.conflictGroupId);
      usedPromotions.add(candidate.id); chosen.push(candidate.candidateKey);
      visit(index + 1, assigned + candidateTotal);
      chosen.pop(); usedPromotions.delete(candidate.id);
      addCounts(selectedKeyCounts, allCandidateKeys, -1);
      addCounts(selectedExclusiveCounts, candidate.exclusiveKeys, -1);
      usedConflictGroups.delete(candidate.conflictGroupId);
      for (const key of candidate.claims.keys()) used.delete(key);
    }
    visit(index + 1, assigned);
  };
  visit(0, BigInt(0));
  if (bestTotal === null) throw new Error('PROMOTION_PRICE_COVERAGE_REQUIRED');
  if (bestTotal > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_PROMOTION_AMOUNT');
  const chosenCandidates = best.map((key) => eligible.find((candidate) => candidate.candidateKey === key)!);
  return { totalCents: Number(bestTotal), promotionIds: chosenCandidates.map((candidate) => candidate.id),
    allocationIds: chosenCandidates.map((candidate) => candidate.allocationId) };
}
