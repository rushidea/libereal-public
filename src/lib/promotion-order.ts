import { calculateBoundPromotions } from '@/data/promotion-calculation';
import { computePromoAdjustments, toVerifiedCartLines, type PromoComputation } from './cart-promotions/service';
import { foundationEnabled, withPromotionRepository } from './promotion-repository';
import type { VerifiedItem, PriceLookupItem } from './pricing';
import type { PromotionStatus } from '@/data/promotion-calculation';
import { Prisma } from '@prisma/client';

export type OrderPromotionResult = PromoComputation & {
  statuses?: PromotionStatus[];
  lineRules?: Record<string, { id: string; version: number }>;
  lineAllocations?: Record<string, Array<{ id: string; version: number; quantity: number; discountCents: number }>>;
  appliedRules?: Record<string, number>;
  candidateRules?: Record<string, number>;
};

export async function assertPromotionVersions(tx: Prisma.TransactionClient,
  rules: OrderPromotionResult['lineRules'] | OrderPromotionResult['appliedRules'], now = new Date(), productIds?: string[]) {
  const values = Object.entries(rules ?? {});
  const versions = new Map(values.map(([id, entry]) => typeof entry === 'number' ? [id, entry] : [entry.id, entry.version]));
  if (productIds?.length) {
    const ids = [...new Set(productIds)];
    const candidates = await tx.$queryRaw<Array<{ id: string; ruleVersion: number; status: string; startsAt: Date | number | string; endsAt: Date | number | string }>>(
      Prisma.sql`SELECT DISTINCT p.id, p.ruleVersion, p.status, p.startsAt, p.endsAt
        FROM Promotion p JOIN PromotionProduct pp ON pp.promotionId = p.id
        WHERE p.ruleDefinition IS NOT NULL AND pp.productId IN (${Prisma.join(ids)})`,
    );
    const active = candidates.filter((row) => row.status === 'active' && new Date(row.startsAt) <= now && new Date(row.endsAt) > now);
    if (active.length !== versions.size || active.some((row) => row.ruleVersion !== versions.get(row.id))) {
      throw new Error('PROMOTION_CHANGED');
    }
    return;
  }
  if (!versions.size) return;
  const rows = await tx.$queryRaw<Array<{ id: string; ruleVersion: number; status: string; startsAt: Date | number | string; endsAt: Date | number | string }>>(
    Prisma.sql`SELECT id, ruleVersion, status, startsAt, endsAt FROM Promotion WHERE id IN (${Prisma.join([...versions.keys()])})`,
  );
  if (rows.length !== versions.size || rows.some((row) => row.ruleVersion !== versions.get(row.id) || row.status !== 'active'
    || new Date(row.startsAt) > now || new Date(row.endsAt) <= now)) throw new Error('PROMOTION_CHANGED');
}

/** 切换开关保证新旧引擎只取一个计价结果。 */
export function computeOrderPromotions(items: VerifiedItem[], submitted: PriceLookupItem[], now = new Date()): OrderPromotionResult {
  if (!foundationEnabled()) return computePromoAdjustments(toVerifiedCartLines(items, submitted), now);
  const lines = items.flatMap((item, index) => item.source === 'db' && item.productId ? [{
    id: String(index), productId: item.productId, variantId: item.variantId ?? null,
    quantity: item.quantity, unitPriceCents: Math.round(item.unitPrice * 100),
    basePriceCents: Math.round((item.baseUnitPrice ?? item.unitPrice) * 100),
  }] : []);
  const campaigns = withPromotionRepository((repository) => repository.activeForProducts(lines.map((line) => line.productId), now));
  const result = calculateBoundPromotions(lines, campaigns, now);
  const campaignNames = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
  return {
    issues: [], evals: [], statuses: result.statuses, lineRules: result.lineRules,
    lineAllocations: result.lineAllocations, appliedRules: result.appliedRules,
    candidateRules: Object.fromEntries(campaigns.map((campaign) => [campaign.id, campaign.version])),
    discountTotal: result.discountCents / 100,
    lineDiscounts: Object.fromEntries(Object.entries(result.lineDiscounts).map(([id, cents]) => [id, cents / 100])),
    linePromotionLabels: Object.fromEntries(Object.entries(result.lineRules).map(([id, rule]) => [
      id,
      [campaignNames.get(rule.id) ?? rule.id],
    ])),
    adjustments: result.statuses.filter((status) => status.discountCents > 0).map((status) => ({
      type: 'promotion_bound', label: status.name, amount: -status.discountCents / 100, reason: status.message,
    })),
  };
}
