export type PricingStage =
  | 'base'
  | 'variant'
  | 'tier_discount'
  | 'brand_discount'
  | 'promotion'
  | 'manual_adjustment'
  | 'minimum_price';

export interface PricingDisplayStep {
  stage: PricingStage;
  source: string;
  before: number;
  after: number;
  applied: boolean;
  reason: string;
}

export interface PricingDisplaySnapshot {
  finalPrice: number;
  currency: string;
  appliedSource: string;
  minimumPriceApplied: boolean;
  steps: PricingDisplayStep[];
}

export const PRICING_STAGE_LABELS: Record<PricingStage, string> = {
  base: '基础价格',
  variant: '规格价格',
  tier_discount: '额外折扣',
  brand_discount: '品牌专属折扣',
  promotion: '活动价格',
  manual_adjustment: '人工报价调整',
  minimum_price: '最低成交价保护',
};

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function parsePricingSnapshot(value: unknown): PricingDisplaySnapshot | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const parsed = JSON.parse(value) as Partial<PricingDisplaySnapshot>;
    if (!finiteNumber(parsed.finalPrice) || !Array.isArray(parsed.steps)) return null;

    const steps = parsed.steps.filter((step): step is PricingDisplayStep => {
      if (!step || typeof step !== 'object') return false;
      const candidate = step as Partial<PricingDisplayStep>;
      return typeof candidate.stage === 'string'
        && candidate.stage in PRICING_STAGE_LABELS
        && typeof candidate.source === 'string'
        && finiteNumber(candidate.before)
        && finiteNumber(candidate.after)
        && typeof candidate.applied === 'boolean'
        && typeof candidate.reason === 'string';
    });

    return {
      finalPrice: parsed.finalPrice,
      currency: typeof parsed.currency === 'string' ? parsed.currency : 'CNY',
      appliedSource: typeof parsed.appliedSource === 'string' ? parsed.appliedSource : 'unknown',
      minimumPriceApplied: parsed.minimumPriceApplied === true,
      steps,
    };
  } catch {
    return null;
  }
}
