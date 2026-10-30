import type { BoundPromotion } from '@/data/promotion-calculation';
import { promotionSkuKey } from '@/data/promotion-foundation';
import { enumeratePromotionCandidates, type CandidateCartLine } from '@/lib/promotion-candidate-enumerator';
import { solvePromotionPlan, type QualifiedPlanCandidate } from '@/lib/promotion-plan-solver';

/** Server-only shared pricing contract; caller must supply verified prices, identities and activities. */
export function calculateUnifiedPromotionPricing(lines: CandidateCartLine[], campaigns: BoundPromotion[], now: Date,
  additionalCampaigns: BoundPromotion[] = [], additionalCandidates: QualifiedPlanCandidate[] = []) {
  const allCampaigns = [...campaigns, ...additionalCampaigns];
  const { cart, candidates: generated } = enumeratePromotionCandidates(lines, allCampaigns, now, 100000, additionalCandidates.length > 0);
  const campaignById = new Map(allCampaigns.map((campaign) => [campaign.id, campaign]));
  const candidates = generated.map((candidate) => {
    const campaign = campaignById.get(candidate.promotionId);
    if (!campaign) throw new Error('INVALID_PROMOTION_CANDIDATE');
    const groupRoles = new Map(campaign.definition.groups.map((group) => [group.key, group.role]));
    const bindings = new Map(campaign.bindings.map((binding) => [promotionSkuKey(binding), binding.groupKey]));
    const candidateLines = candidate.lines.map((line) => {
      const groupKey = bindings.get(promotionSkuKey(line));
      const role = groupKey ? groupRoles.get(groupKey) : undefined;
      if (!role) throw new Error('INVALID_PROMOTION_CANDIDATE');
      return role === 'qualifier' ? { ...line, role: 'qualifier' as const, zeroPriceAuthorized: undefined }
        : { ...line, role: 'benefit' as const };
    });
    return { ...candidate, lines: candidateLines,
      ...(campaign.legacyRuleIdentity ? { conflictGroupId: campaign.legacyRuleIdentity } : {}) };
  });
  const allCandidates = [...candidates, ...additionalCandidates];
  const plan = solvePromotionPlan(cart, allCandidates);
  const selected = plan.promotionIds.map((promotionId, index) => {
    const match = allCandidates.find((candidate) => candidate.promotionId === promotionId && (candidate.allocationId ?? candidate.promotionId) === plan.allocationIds[index]);
    if (!match) throw new Error('INVALID_PROMOTION_PLAN');
    return match;
  });
  const assignments = new Map<string, { promotionId: string; totalAfterCents?: number; role: 'benefit' | 'qualifier'; priceBands?: QualifiedPlanCandidate['lines'][number]['priceBands'] }>();
  for (const candidate of selected) {
    for (const line of candidate.lines) {
      const key = promotionSkuKey(line);
      if (assignments.has(key)) throw new Error('INVALID_PROMOTION_PLAN');
      assignments.set(key, { promotionId: candidate.promotionId, role: line.role ?? 'benefit',
        totalAfterCents: line.totalAfterCents, priceBands: line.priceBands });
    }
  }
  const results = cart.map((line) => {
    const applied = assignments.get(promotionSkuKey(line));
    const isBenefit = applied?.role !== 'qualifier';
    const totalAfterCents = isBenefit ? (applied?.totalAfterCents ?? line.totalCents) : line.totalCents;
    if (totalAfterCents === null) throw new Error('PROMOTION_PRICE_COVERAGE_REQUIRED');
    return { ...line, promotionId: isBenefit ? applied?.promotionId ?? null : null,
      occupiedPromotionId: applied?.promotionId ?? null, totalAfterCents,
      priceBands: applied?.priceBands ?? line.ordinaryBands?.map((band) => {
        if (band.unitCents === null) throw new Error('PROMOTION_PRICE_COVERAGE_REQUIRED');
        return { sourceLineId: band.sourceLineId, quantity: band.quantity, unitCents: band.unitCents, source: 'ordinary' as const };
      }) };
  });
  const totalCents = results.reduce((sum, line) => sum + line.totalAfterCents, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents !== plan.totalCents) throw new Error('INVALID_PROMOTION_PLAN');
  return { totalCents, lines: results, promotionIds: plan.promotionIds, allocationIds: plan.allocationIds };
}
