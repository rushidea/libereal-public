import { calculateBoundPromotions, type BoundPromotion, type PromotionPricingLine } from '@/data/promotion-calculation';
import { promotionSkuKey, validatePromotionBindings } from '@/data/promotion-foundation';
import type { PromotionPlanLine, QualifiedPlanCandidate } from '@/lib/promotion-plan-solver';
import { catalogPercentageCents } from '@/lib/promotion-catalog-pricing';

/** This input is server-verified; no client-supplied price may reach this boundary. */
export type CandidateCartLine = Omit<PromotionPricingLine, 'unitPriceCents' | 'basePriceCents'> & {
  sourceLineId?: string;
  databasePromotionEligible?: boolean;
  unitPriceCents: number | null;
  basePriceCents: number | null;
  catalogReferenceCents?: number | null;
  /** Trusted server-derived minimum payable price for one allocated unit, in cents. */
  minimumUnitCents?: number | null;
  /** Server-derived legacy reference-price results, keyed by promotion ID. */
  legacyPromotionUnitPriceOverridesCents?: Record<string, number>;
};
export type EnumeratedCandidates = { cart: PromotionPlanLine[]; candidates: QualifiedPlanCandidate[] };

type CandidatePriceBand = NonNullable<QualifiedPlanCandidate['lines'][number]['priceBands']>[number];

/** Split an exact aggregate into integer-cent per-unit bands without inventing an average price. */
function appendPriceBand(bands: CandidatePriceBand[], totalCents: number, quantity: number,
  sourceFor: CandidatePriceBand['source'] | ((unitCents: number) => CandidatePriceBand['source'])): void {
  if (!quantity) return;
  if (!Number.isSafeInteger(totalCents) || totalCents < 0 || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('INVALID_PROMOTION_AMOUNT');
  const unitCents = Math.floor(totalCents / quantity);
  const remainder = totalCents % quantity;
  const source = (unit: number) => typeof sourceFor === 'function' ? sourceFor(unit) : sourceFor;
  const push = (unit: number, count: number) => {
    if (!count) return;
    const label = source(unit);
    const existing = bands.find((band) => band.unitCents === unit && band.source === label);
    if (existing) {
      existing.quantity += count;
      if (!Number.isSafeInteger(existing.quantity)) throw new Error('INVALID_PROMOTION_AMOUNT');
    } else bands.push({ unitCents: unit, quantity: count, source: label });
  };
  if (remainder) push(unitCents + 1, remainder);
  push(unitCents, quantity - remainder);
}

function priceBandTotal(bands: CandidatePriceBand[]): number {
  const total = bands.reduce((sum, band) => sum + BigInt(band.unitCents) * BigInt(band.quantity), BigInt(0));
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_PROMOTION_AMOUNT');
  return Number(total);
}

function canonicalLegacyOverrides(value: Record<string, number> | undefined): string {
  return JSON.stringify(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)));
}

/** Evaluate trusted sources separately, then claim their complete real SKU. */
function enumerateSourceCandidates(lines: CandidateCartLine[], campaigns: BoundPromotion[], now: Date, maxWork: number, disableDirectPriceFastPath: boolean): EnumeratedCandidates {
  const ids = new Set<string>();
  const grouped = new Map<string, CandidateCartLine[]>();
  for (const line of lines) {
    if (!line.sourceLineId || ids.has(line.sourceLineId) || !Number.isSafeInteger(line.quantity) || line.quantity <= 0
      || (line.unitPriceCents !== null && (!Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents <= 0))) throw new Error('INVALID_PROMOTION_PLAN_CART');
    ids.add(line.sourceLineId);
    const key = promotionSkuKey(line); const group = grouped.get(key) ?? [];
    group.push(line); grouped.set(key, group);
  }
  const cart: PromotionPlanLine[] = [...grouped.values()].map((group) => {
    const ordinaryBands = group.map((line) => ({ sourceLineId: line.sourceLineId!, quantity: line.quantity, unitCents: line.unitPriceCents }));
    const quantity = group.reduce((sum, line) => sum + line.quantity, 0);
    const sum = group.reduce((total, line) => total + BigInt(line.quantity) * BigInt(line.unitPriceCents ?? 0), BigInt(0));
    if (!Number.isSafeInteger(quantity) || sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_PROMOTION_AMOUNT');
    return { productId: group[0].productId, variantId: group[0].variantId, quantity,
      totalCents: group.some((line) => line.unitPriceCents === null) ? null : Number(sum), ordinaryBands };
  });
  const virtual = lines.map((line, index) => ({ ...line, sourceLineId: undefined, databasePromotionEligible: undefined,
    sameSkuGroupKey: promotionSkuKey(line), productId: `__pricing_source_${index}`, variantId: null }));
  const byVirtual = new Map(virtual.map((line, index) => [promotionSkuKey(line), lines[index]]));
  const virtualCampaigns = campaigns.map((campaign) => {
    const bindings = campaign.bindings.flatMap((binding) => lines.flatMap((line, index) =>
      promotionSkuKey(binding) === promotionSkuKey(line) && line.databasePromotionEligible !== false
        ? [{ productId: virtual[index].productId, variantId: null, groupKey: binding.groupKey }] : []));
    for (const group of campaign.definition.groups) if (!bindings.some((binding) => binding.groupKey === group.key)) {
      bindings.push({ productId: `__pricing_missing_${campaign.id}_${group.key}`, variantId: null, groupKey: group.key });
    }
    return { ...campaign, bindings };
  });
  const generated = enumeratePromotionCandidates(virtual, virtualCampaigns, now, maxWork, disableDirectPriceFastPath).candidates;
  const candidates: QualifiedPlanCandidate[] = [];
  for (const candidate of generated) {
    const touched = new Map<string, Map<string, QualifiedPlanCandidate['lines'][number]>>();
    for (const claim of candidate.lines) {
      const source = byVirtual.get(promotionSkuKey(claim));
      if (!source || !source.sourceLineId || !claim.priceBands) throw new Error('INVALID_PROMOTION_CANDIDATE');
      const key = promotionSkuKey(source); const entries = touched.get(key) ?? new Map();
      entries.set(source.sourceLineId, claim); touched.set(key, entries);
    }
    const claims: QualifiedPlanCandidate['lines'] = []; let missing = false;
    for (const [key, entries] of touched) {
      const group = grouped.get(key)!; const priceBands: CandidatePriceBand[] = [];
      for (const source of group) {
        const claim = entries.get(source.sourceLineId!);
        if (claim) priceBands.push(...claim.priceBands!.map((band) => ({ ...band, sourceLineId: source.sourceLineId })));
        else if (source.unitPriceCents !== null) priceBands.push({ sourceLineId: source.sourceLineId, quantity: source.quantity, unitCents: source.unitPriceCents, source: 'ordinary' });
        else { missing = true; break; }
      }
      if (missing) break;
      claims.push({ productId: group[0].productId, variantId: group[0].variantId,
        quantity: group.reduce((sum, line) => sum + line.quantity, 0), totalAfterCents: priceBandTotal(priceBands), priceBands });
    }
    if (missing || !claims.length) continue;
    claims.sort((a, b) => promotionSkuKey(a).localeCompare(promotionSkuKey(b)));
    candidates.push({ promotionId: candidate.promotionId, qualified: true, allocationId: JSON.stringify(claims), lines: claims });
  }
  const unique = new Map(candidates.map((candidate) => [JSON.stringify([candidate.promotionId, candidate.allocationId]), candidate]));
  return { cart, candidates: [...unique.values()] };
}

/**
 * Enumerate per-campaign quantity vectors and SKU orderings over one immutable cart.
 * A hard work budget applies to both recursion and evaluator calls. A limit error
 * invalidates the entire result; it never returns a truncated candidate set.
 */
export function enumeratePromotionCandidates(lines: CandidateCartLine[], campaigns: BoundPromotion[], now: Date, maxWork = 100000, disableDirectPriceFastPath = false): EnumeratedCandidates {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1 || !Number.isFinite(now.getTime())) throw new Error('INVALID_PROMOTION_ENUMERATION');
  if (lines.some((line) => line.sourceLineId !== undefined)) return enumerateSourceCandidates(lines, campaigns, now, maxWork, disableDirectPriceFastPath);
  if (lines.length > 2000 || campaigns.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  let work = 0;
  const charge = (units = 1) => { work += units; if (!Number.isSafeInteger(work) || work > maxWork) throw new Error('PROMOTION_ENUMERATION_LIMIT'); };
  const cartMap = new Map<string, CandidateCartLine>();
  for (const line of lines) {
    if (!line.productId || (line.variantId !== null && !line.variantId) || !Number.isSafeInteger(line.quantity) || line.quantity <= 0
      || (line.unitPriceCents !== null && (!Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents <= 0))
      || (line.basePriceCents !== null && (!Number.isSafeInteger(line.basePriceCents) || line.basePriceCents <= 0))
      || (line.catalogReferenceCents != null && (!Number.isSafeInteger(line.catalogReferenceCents) || line.catalogReferenceCents <= 0))
      || (line.minimumUnitCents != null && (!Number.isSafeInteger(line.minimumUnitCents) || line.minimumUnitCents <= 0
        || (line.unitPriceCents !== null && line.minimumUnitCents > line.unitPriceCents)))
      || (line.legacyPromotionUnitPriceOverridesCents != null && (typeof line.legacyPromotionUnitPriceOverridesCents !== 'object'
        || Array.isArray(line.legacyPromotionUnitPriceOverridesCents)
        || Object.entries(line.legacyPromotionUnitPriceOverridesCents).some(([id, value]) => !id
          || !Number.isSafeInteger(value) || value <= 0)))) throw new Error('INVALID_PROMOTION_PLAN_CART');
    const key = promotionSkuKey(line); const current = cartMap.get(key);
    if (current) {
      if (current.unitPriceCents !== line.unitPriceCents || current.basePriceCents !== line.basePriceCents
        || (current.catalogReferenceCents ?? null) !== (line.catalogReferenceCents ?? null)
        || (current.minimumUnitCents ?? null) !== (line.minimumUnitCents ?? null)
        || canonicalLegacyOverrides(current.legacyPromotionUnitPriceOverridesCents) !== canonicalLegacyOverrides(line.legacyPromotionUnitPriceOverridesCents)) throw new Error('PROMOTION_SKU_PRICE_MISMATCH');
      current.quantity += line.quantity;
      if (!Number.isSafeInteger(current.quantity)) throw new Error('INVALID_PROMOTION_AMOUNT');
    } else cartMap.set(key, { ...line });
  }
  const normalized = [...cartMap.values()].sort((a, b) => promotionSkuKey(a) < promotionSkuKey(b) ? -1 : promotionSkuKey(a) > promotionSkuKey(b) ? 1 : 0);
  if (normalized.length > 200 || campaigns.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  let totalQuantity = 0;
  for (const line of normalized) {
    totalQuantity += line.quantity;
    if (!Number.isSafeInteger(totalQuantity)) throw new Error('INVALID_PROMOTION_AMOUNT');
  }
  const cart = normalized.map((line) => {
    const totalCents = line.unitPriceCents === null ? null : line.quantity * line.unitPriceCents;
    if (totalCents !== null && !Number.isSafeInteger(totalCents)) throw new Error('INVALID_PROMOTION_AMOUNT');
    return { productId: line.productId, variantId: line.variantId, quantity: line.quantity, totalCents };
  });
  const candidates: QualifiedPlanCandidate[] = [];
  const campaignIds = new Set<string>();
  const activeOwners = new Map<string, Set<string>>();
  for (const campaign of campaigns) {
    if (campaign.bindings.length > 2000 || campaign.definition.groups.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    if (campaign.status !== 'active' || campaign.startsAt > now || campaign.endsAt <= now) continue;
    charge(1 + campaign.bindings.length);
    for (const binding of campaign.bindings) {
      const key = promotionSkuKey(binding); const owners = activeOwners.get(key) ?? new Set<string>();
      owners.add(campaign.id); activeOwners.set(key, owners);
    }
  }
  for (const campaign of campaigns) {
    if (!campaign.id || campaignIds.has(campaign.id)) throw new Error('INVALID_PROMOTION_CANDIDATE');
    if (campaign.bindings.length > 2000 || campaign.definition.groups.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    campaignIds.add(campaign.id);
    if (campaign.status !== 'active' || campaign.startsAt > now || campaign.endsAt <= now) continue;
    charge(1 + campaign.bindings.length + campaign.definition.groups.length);
    validatePromotionBindings(campaign.definition, campaign.bindings);
    const bound = new Set(campaign.bindings.map(promotionSkuKey));
    const bindingsBySku = new Map(campaign.bindings.map((binding) => [promotionSkuKey(binding), binding]));
    let relevant = normalized.filter((line) => bound.has(promotionSkuKey(line)));
    if (!relevant.length) continue;
    if (campaign.definition.priceBasis === 'catalog') {
      const definition = campaign.definition;
      if (definition.benefit.kind !== 'percentage') throw new Error('PROMOTION_CATALOG_RULE_UNSUPPORTED');
      const basisPoints = definition.benefit.basisPoints;
      const groupRoles = new Map(definition.groups.map((group) => [group.key, group.role]));
      const unitPrices = new Map<string, number>();
      let catalogCoveredSkus = 0;
      for (const line of relevant) {
        const group = bindingsBySku.get(promotionSkuKey(line));
        if (!group) throw new Error('INVALID_PROMOTION_CANDIDATE');
        if (groupRoles.get(group.groupKey) === 'qualifier') continue;
        if (line.catalogReferenceCents != null) {
          unitPrices.set(promotionSkuKey(line), catalogPercentageCents(line.catalogReferenceCents, basisPoints));
          catalogCoveredSkus++;
        }
      }
      if (!catalogCoveredSkus) throw new Error('PROMOTION_CATALOG_PRICE_REQUIRED');
      const counts = new Array<number>(relevant.length).fill(0);
      const unique = new Map<string, QualifiedPlanCandidate>();
      const quantitiesForOrder = (ordered: number[]): Map<number, number> => {
        const remaining = new Map(ordered.map((index) => [index, counts[index]]));
        const allocations = new Map<number, number>();
        const indicesForGroup = (groupKey: string) => ordered.filter((index) => bindingsBySku.get(promotionSkuKey(relevant[index]))?.groupKey === groupKey);
        const availableTotal = (indices: number[]) => indices.reduce((sum, index) => sum + (remaining.get(index) ?? 0), 0);
        const allocatedTotal = (indices: number[]) => indices.reduce((sum, index) => sum + (allocations.get(index) ?? 0), 0);
        const reserve = (indices: number[], requested: number) => {
          let quantity = requested;
          for (const index of indices) {
            const count = Math.min(quantity, remaining.get(index) ?? 0);
            if (!count) continue;
            remaining.set(index, (remaining.get(index) ?? 0) - count);
            allocations.set(index, (allocations.get(index) ?? 0) + count);
            quantity -= count;
            if (!quantity) break;
          }
          return quantity === 0;
        };
        const qualifiers = definition.groups.filter((group) => group.role !== 'benefit');
        let applications = qualifiers.length ? Math.min(...qualifiers.map((group) =>
          Math.floor(availableTotal(indicesForGroup(group.key)) / group.quantity))) : 1;
        if (!definition.repeat) applications = Math.min(applications, 1);
        if (definition.maxApplications !== null) applications = Math.min(applications, definition.maxApplications);
        if (definition.template !== 'direct-price') {
          for (const group of definition.groups.filter((entry) => entry.role === 'benefit')) {
            const indices = indicesForGroup(group.key);
            const count = group.role === 'qualifier-and-benefit' ? allocatedTotal(indices) : availableTotal(indices);
            const benefitApplications = definition.partialBenefit
              ? (count > 0 ? Math.ceil(count / group.quantity) : 0)
              : Math.floor(count / group.quantity);
            applications = Math.min(applications, benefitApplications);
          }
        }
        if (!applications) return new Map();
        for (const group of qualifiers) {
          if (!reserve(indicesForGroup(group.key), applications * group.quantity)) return new Map();
        }
        let benefitedQuantity = 0;
        for (const group of definition.groups.filter((entry) => entry.role !== 'qualifier')) {
          const indices = indicesForGroup(group.key);
          const count = group.role === 'qualifier-and-benefit' ? allocatedTotal(indices) : availableTotal(indices);
          const maxByApplications = definition.template === 'direct-price'
            ? BigInt(definition.repeat ? definition.maxApplications ?? count : 1) * BigInt(group.quantity)
            : BigInt(applications) * BigInt(group.quantity);
          let quota = Number(maxByApplications < BigInt(count) ? maxByApplications : BigInt(count));
          if (!definition.partialBenefit) quota = Math.min(quota, Math.floor(count / group.quantity) * group.quantity);
          const selected: Array<{ index: number; quantity: number }> = [];
          for (const index of indices) {
            const available = group.role === 'qualifier-and-benefit' ? allocations.get(index) ?? 0 : remaining.get(index) ?? 0;
            const quantity = Math.min(quota, available);
            quota -= quantity;
            if (quantity) selected.push({ index, quantity });
            benefitedQuantity += quantity;
          }
          if (group.role === 'benefit') {
            const requested = selected.reduce((sum, item) => sum + item.quantity, 0);
            // The standard evaluator reserves the selected benefit quota in
            // SKU order after choosing it from the same available sequence.
            if (!reserve(indices, requested)) return new Map();
          }
        }
        return benefitedQuantity ? allocations : new Map();
      };
      const evaluateOrder = (ordered: number[]) => {
        charge(1 + definition.groups.length * ordered.length);
        const allocated = quantitiesForOrder(ordered);
        const claims: QualifiedPlanCandidate['lines'] = [];
        let missingCoverage = false;
        for (const [index, quantity] of allocated) {
          if (!quantity) continue;
          const line = relevant[index];
          if (quantity > line.quantity) throw new Error('INVALID_PROMOTION_CANDIDATE');
          const group = bindingsBySku.get(promotionSkuKey(line));
          if (!group) throw new Error('INVALID_PROMOTION_CANDIDATE');
          const benefitQuantity = groupRoles.get(group.groupKey) === 'qualifier' ? 0 : quantity;
          const ordinaryQuantity = line.quantity - benefitQuantity;
          if ((ordinaryQuantity && line.unitPriceCents === null) || (benefitQuantity && !unitPrices.has(promotionSkuKey(line)))) {
            missingCoverage = true;
            break;
          }
          const priceBands: CandidatePriceBand[] = [];
          if (ordinaryQuantity) appendPriceBand(priceBands, line.unitPriceCents! * ordinaryQuantity, ordinaryQuantity, 'ordinary');
          const catalogUnit = benefitQuantity ? unitPrices.get(promotionSkuKey(line))! : 0;
          const flooredUnit = line.minimumUnitCents == null ? catalogUnit : Math.max(line.minimumUnitCents, catalogUnit);
          const benefitUnit = line.unitPriceCents == null ? flooredUnit : Math.min(line.unitPriceCents, flooredUnit);
          if (benefitQuantity) appendPriceBand(priceBands, benefitUnit * benefitQuantity, benefitQuantity,
            (unitCents) => line.unitPriceCents === null || unitCents < line.unitPriceCents ? 'promotion' : 'ordinary');
          claims.push({ productId: line.productId, variantId: line.variantId, quantity: line.quantity,
            totalAfterCents: priceBandTotal(priceBands), priceBands });
        }
        if (missingCoverage || !claims.length || claims.length !== allocated.size) return;
        claims.sort((a, b) => promotionSkuKey(a) < promotionSkuKey(b) ? -1 : promotionSkuKey(a) > promotionSkuKey(b) ? 1 : 0);
        const allocationId = JSON.stringify(claims);
        unique.set(allocationId, { promotionId: campaign.id, allocationId, qualified: true, lines: claims });
        if (candidates.length + unique.size > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
      };
      const permutations = (indices: number[], ordered: number[]) => {
        charge();
        if (!indices.length) { if (ordered.length) evaluateOrder(ordered); return; }
        for (let i = 0; i < indices.length; i++) permutations([...indices.slice(0, i), ...indices.slice(i + 1)], [...ordered, indices[i]]);
      };
      const vectors = (index: number) => {
        charge();
        if (index === relevant.length) { permutations(counts.flatMap((count, i) => count ? [i] : []), []); return; }
        for (let count = 0; count <= relevant[index].quantity; count++) { counts[index] = count; vectors(index + 1); }
      };
      vectors(0);
      candidates.push(...unique.values());
      if (candidates.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
      continue;
    }
    // This legacy evaluator needs both prices; other campaigns may cover the
    // unpriced sources, so omit these sources rather than reject the cart.
    relevant = relevant.filter((line) => line.unitPriceCents !== null && line.basePriceCents !== null);
    if (!relevant.length) continue;
    const overlapsAnotherCampaign = relevant.some((line) => (activeOwners.get(promotionSkuKey(line))?.size ?? 0) > 1);
    const groupRoles = new Map(campaign.definition.groups.map((group) => [group.key, group.role]));
    const hasLegacyOverride = relevant.some((line) => Object.hasOwn(line.legacyPromotionUnitPriceOverridesCents ?? {}, campaign.id));
    const legacyOverridePrices = new Map<number, number>();
    if (hasLegacyOverride) {
      if (campaign.definition.template !== 'direct-price' || campaign.definition.groups.length !== 1
        || campaign.definition.groups[0].role !== 'benefit' || campaign.definition.benefit.kind !== 'percentage') {
        throw new Error('PROMOTION_LEGACY_PRICE_OVERRIDE_UNSUPPORTED');
      }
      for (let i = 0; i < relevant.length; i++) {
        const overrides = relevant[i].legacyPromotionUnitPriceOverridesCents;
        if (!overrides || !Object.hasOwn(overrides, campaign.id)) throw new Error('PROMOTION_LEGACY_PRICE_OVERRIDE_REQUIRED');
        const price = overrides[campaign.id];
        if (!Number.isSafeInteger(price) || price <= 0) throw new Error('INVALID_PROMOTION_PLAN_CART');
        legacyOverridePrices.set(i, price);
      }
    }
    const unique = new Map<string, QualifiedPlanCandidate>();
    const counts = new Array<number>(relevant.length).fill(0);
    const evaluateOrder = (ordered: number[]) => {
      const singleDirect = campaign.definition.template === 'direct-price' && !campaign.definition.repeat
        && campaign.definition.groups.length === 1 && campaign.definition.groups[0].quantity === 1 && ordered.length === 1;
      const evaluationBindings = singleDirect
        ? [bindingsBySku.get(promotionSkuKey(relevant[ordered[0]]))!]
        : campaign.bindings;
      charge(1 + evaluationBindings.length + campaign.definition.groups.length * ordered.length);
      const idToLine = new Map<string, CandidateCartLine>();
      const idToIndex = new Map<string, number>();
      const current = ordered.map((index, rank) => {
        const id = String(rank).padStart(6, '0');
        const line = relevant[index]; idToLine.set(id, line); idToIndex.set(id, index);
        return { ...line, id, quantity: counts[index], unitPriceCents: line.unitPriceCents!, basePriceCents: line.basePriceCents! };
      });
      let result: ReturnType<typeof calculateBoundPromotions> | null = null;
      const allocationsById = new Map<string, number>();
      if (hasLegacyOverride) {
        const group = campaign.definition.groups[0];
        const selectedCount = ordered.reduce((sum, index) => sum + counts[index], 0);
        const cap = BigInt(campaign.definition.repeat ? campaign.definition.maxApplications ?? selectedCount : 1) * BigInt(group.quantity);
        let quota = Number(cap < BigInt(selectedCount) ? cap : BigInt(selectedCount));
        if (!campaign.definition.partialBenefit) quota = Math.min(quota, Math.floor(selectedCount / group.quantity) * group.quantity);
        let hasSaving = false;
        for (let rank = 0; rank < ordered.length && quota > 0; rank++) {
          const index = ordered[rank];
          const quantity = Math.min(quota, counts[index]);
          if (!quantity) continue;
          quota -= quantity;
          const line = relevant[index];
          const floor = line.minimumUnitCents ?? 0;
          const overrideUnit = legacyOverridePrices.get(index)!;
          const payableUnit = Math.min(line.unitPriceCents!, Math.max(floor, overrideUnit));
          if (payableUnit < line.unitPriceCents!) hasSaving = true;
          allocationsById.set(String(rank).padStart(6, '0'), quantity);
        }
        if (!hasSaving) return;
      } else {
        result = calculateBoundPromotions(current, [{ ...campaign, bindings: evaluationBindings }], now, { reserveFreeUnitsInPriceOrder: true, exactMoneyAllocation: true });
        if (!Object.hasOwn(result.appliedRules, campaign.id) || result.discountCents <= 0) return;
        for (const [id, entries] of Object.entries(result.lineAllocations)) {
          allocationsById.set(id, entries.reduce((sum, entry) => sum + entry.quantity, 0));
        }
      }
      const claims = [...allocationsById.keys()].map((id) => {
        const original = idToLine.get(id);
        if (!original) throw new Error('INVALID_PROMOTION_CANDIDATE');
        const originalTotal = original.quantity * original.unitPriceCents!;
        const discount = result?.lineDiscounts[id] ?? 0;
        if (!Number.isSafeInteger(originalTotal) || !Number.isSafeInteger(discount) || discount < 0 || discount > originalTotal) throw new Error('INVALID_PROMOTION_AMOUNT');
        const allocatedQuantity = allocationsById.get(id)!;
        if (allocatedQuantity <= 0 || allocatedQuantity > original.quantity) throw new Error('INVALID_PROMOTION_CANDIDATE');
        const binding = bindingsBySku.get(promotionSkuKey(original));
        if (!binding) throw new Error('INVALID_PROMOTION_CANDIDATE');
        const role = groupRoles.get(binding.groupKey);
        if (!role) throw new Error('INVALID_PROMOTION_CANDIDATE');
        const floor = original.minimumUnitCents ?? 0;
        const priceBands: CandidatePriceBand[] = [];
        if (hasLegacyOverride) {
          const overrideUnit = legacyOverridePrices.get(idToIndex.get(id)!)!;
          const payableUnit = Math.min(original.unitPriceCents!, Math.max(floor, overrideUnit));
          appendPriceBand(priceBands, payableUnit * allocatedQuantity, allocatedQuantity,
            payableUnit < original.unitPriceCents! ? 'promotion' : 'ordinary');
          appendPriceBand(priceBands, original.unitPriceCents! * (original.quantity - allocatedQuantity), original.quantity - allocatedQuantity, 'ordinary');
          return { productId: original.productId, variantId: original.variantId, quantity: original.quantity,
            totalAfterCents: priceBandTotal(priceBands), priceBands };
        }
        const giftPackage = campaign.definition.template === 'same-sku-gift' || campaign.definition.template === 'buy-n-get-m';
        if (giftPackage) {
          if (discount % original.unitPriceCents! !== 0) throw new Error('PROMOTION_MINIMUM_PRICE_UNSUPPORTED');
          const freeQuantity = discount / original.unitPriceCents!;
          if (freeQuantity > allocatedQuantity) throw new Error('INVALID_PROMOTION_CANDIDATE');
          appendPriceBand(priceBands, floor * freeQuantity, freeQuantity,
            floor < original.unitPriceCents! ? 'promotion' : 'ordinary');
          appendPriceBand(priceBands, original.unitPriceCents! * (original.quantity - freeQuantity), original.quantity - freeQuantity, 'ordinary');
          return { productId: original.productId, variantId: original.variantId, quantity: original.quantity,
            totalAfterCents: priceBandTotal(priceBands), priceBands };
        }
        if (role === 'qualifier') {
          appendPriceBand(priceBands, originalTotal, original.quantity, 'ordinary');
          return { productId: original.productId, variantId: original.variantId, quantity: original.quantity,
            totalAfterCents: priceBandTotal(priceBands), priceBands };
        }
        const benefit = campaign.definition.benefit;
        let benefitTotal: bigint;
        if (benefit.kind === 'group-price') {
          // The evaluator exposes the exact per-SKU share of a group target as
          // a line total. Flooring that total to minimum × allocated quantity
          // is exact without inventing a per-unit remainder allocation.
          const promoTotal = BigInt(original.unitPriceCents!) * BigInt(allocatedQuantity) - BigInt(discount);
          const floorTotal = BigInt(floor) * BigInt(allocatedQuantity);
          benefitTotal = promoTotal > floorTotal ? promoTotal : floorTotal;
        } else {
          const benefitUnit = benefit.kind === 'gift' ? 0
            : benefit.kind === 'fixed-price' ? benefit.unitPriceCents
              : benefit.kind === 'amount-off' ? Math.max(0, original.basePriceCents! - benefit.amountCents)
                : Number((BigInt(original.basePriceCents!) * BigInt(benefit.basisPoints) + BigInt(5000)) / BigInt(10000));
          const flooredUnit = Math.max(floor, benefitUnit);
          const payableUnit = Math.min(original.unitPriceCents!, flooredUnit);
          benefitTotal = BigInt(payableUnit) * BigInt(allocatedQuantity);
        }
        const actualBenefitTotal = Number(benefitTotal);
        if (!Number.isSafeInteger(actualBenefitTotal)) throw new Error('INVALID_PROMOTION_AMOUNT');
        appendPriceBand(priceBands, actualBenefitTotal, allocatedQuantity,
          (unitCents) => unitCents < original.unitPriceCents! ? 'promotion' : 'ordinary');
        appendPriceBand(priceBands, original.unitPriceCents! * (original.quantity - allocatedQuantity), original.quantity - allocatedQuantity, 'ordinary');
        return { productId: original.productId, variantId: original.variantId, quantity: original.quantity,
          totalAfterCents: priceBandTotal(priceBands), priceBands };
      }).sort((a, b) => promotionSkuKey(a) < promotionSkuKey(b) ? -1 : promotionSkuKey(a) > promotionSkuKey(b) ? 1 : 0);
      const allocationId = JSON.stringify(claims);
      unique.set(allocationId, { promotionId: campaign.id, allocationId, qualified: true, lines: claims });
      if (unique.size > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    };
    const permutations = (indices: number[], ordered: number[]) => {
      charge();
      if (!indices.length) { if (ordered.length) evaluateOrder(ordered); return; }
      for (let i = 0; i < indices.length; i++) permutations([...indices.slice(0, i), ...indices.slice(i + 1)], [...ordered, indices[i]]);
    };
    const vectors = (index: number) => {
      charge();
      if (index === relevant.length) { permutations(counts.flatMap((count, i) => count ? [i] : []), []); return; }
      for (let count = 0; count <= relevant[index].quantity; count++) { counts[index] = count; vectors(index + 1); }
    };
    // A non-repeating direct-price rule for one unit can select at most one
    // SKU. Enumerating every permutation would add no legal alternatives and
    // can exhaust the budget for a simple multi-SKU activity.
    if (campaign.definition.template === 'direct-price' && campaign.definition.repeat
      && campaign.definition.maxApplications === null && campaign.definition.groups.length === 1
      && campaign.definition.groups[0].quantity === 1 && campaign.definition.benefit.kind !== 'group-price'
      && !overlapsAnotherCampaign && !disableDirectPriceFastPath) {
      for (let i = 0; i < relevant.length; i++) counts[i] = relevant[i].quantity;
      evaluateOrder(relevant.map((_, i) => i));
    } else if (campaign.definition.template === 'direct-price' && !campaign.definition.repeat
      && campaign.definition.groups.length === 1 && campaign.definition.groups[0].quantity === 1) {
      for (let i = 0; i < relevant.length; i++) { counts[i] = 1; evaluateOrder([i]); counts[i] = 0; }
    } else vectors(0);
    candidates.push(...unique.values());
    if (candidates.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  }
  return { cart, candidates };
}
