import { TIER_DISCOUNT_RATES } from '@/lib/discount';

export type PriceAdjustment =
  | { type: 'fixed_price'; value: number; reason?: string }
  | { type: 'discount_rate'; value: number; reason?: string }
  | { type: 'amount_off'; value: number; reason?: string };

export type PromotionCandidate = PriceAdjustment & {
  id: string;
  name: string;
  priority: number;
  exclusive: boolean;
};

export interface PriceStep {
  stage: 'base' | 'variant' | 'tier_discount' | 'brand_discount' | 'promotion' | 'manual_adjustment' | 'minimum_price';
  source: string;
  before: number;
  after: number;
  applied: boolean;
  reason: string;
}

export interface PriceCalculationInput {
  basePrice: number;
  variantPrice?: number | null;
  tier?: string | null;
  personalDiscountRate?: number | null;
  brandDiscountRate?: number | null;
  promotions?: PromotionCandidate[];
  manualAdjustment?: PriceAdjustment | null;
  minimumSalePrice?: number | null;
  currency?: string;
}

export interface PriceCalculationResult {
  finalPrice: number;
  currency: string;
  appliedSource: string;
  minimumPriceApplied: boolean;
  steps: PriceStep[];
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function validPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1;
}

function adjustedPrice(price: number, adjustment: PriceAdjustment): number {
  if (!validPrice(adjustment.value)) throw new Error('INVALID_PRICE_ADJUSTMENT');
  if (adjustment.type === 'fixed_price') return money(adjustment.value);
  if (adjustment.type === 'discount_rate') {
    if (!validRate(adjustment.value)) throw new Error('INVALID_DISCOUNT_RATE');
    return money(price * adjustment.value);
  }
  return money(Math.max(0, price - adjustment.value));
}

export function calculatePrice(input: PriceCalculationInput): PriceCalculationResult {
  if (!validPrice(input.basePrice)) throw new Error('INVALID_BASE_PRICE');
  const steps: PriceStep[] = [];
  let price = money(input.basePrice);
  let appliedSource = 'base_price';
  steps.push({ stage: 'base', source: 'base_price', before: price, after: price, applied: true, reason: '商品基础价格' });

  if (validPrice(input.variantPrice) && input.variantPrice > 0) {
    const before = price;
    price = money(input.variantPrice);
    appliedSource = 'variant_price';
    steps.push({ stage: 'variant', source: 'variant_price', before, after: price, applied: true, reason: '规格价格覆盖基础价格' });
  }

  const undiscounted = price;
  const tierRate = validRate(input.personalDiscountRate)
    ? input.personalDiscountRate
    : TIER_DISCOUNT_RATES[input.tier || ''] ?? 1;
  const tierPrice = money(undiscounted * tierRate);
  steps.push({
    stage: 'tier_discount',
    source: validRate(input.personalDiscountRate) ? 'personal_discount' : `tier:${input.tier || 'none'}`,
    before: undiscounted,
    after: tierPrice,
    applied: tierRate < 1,
    reason: validRate(input.personalDiscountRate) ? '个人统一折扣替代等级折扣' : '用户等级折扣',
  });

  let userPrice = tierPrice;
  if (validRate(input.brandDiscountRate)) {
    const brandPrice = money(undiscounted * input.brandDiscountRate);
    userPrice = brandPrice;
    steps.push({
      stage: 'brand_discount', source: 'brand_discount', before: tierPrice, after: brandPrice,
      applied: true, reason: '品牌专属折扣与等级折扣互斥，品牌折扣优先',
    });
  }

  price = userPrice;
  appliedSource = validRate(input.brandDiscountRate) ? 'brand_discount' : tierRate < 1 ? 'user_discount' : appliedSource;
  const promotionPrices = (input.promotions || []).map((promotion) => ({ promotion, price: adjustedPrice(undiscounted, promotion) }));
  promotionPrices.sort((a, b) => a.price - b.price || b.promotion.priority - a.promotion.priority || a.promotion.id.localeCompare(b.promotion.id));
  const selectedPromotion = promotionPrices[0];
  if (selectedPromotion) {
    const applied = selectedPromotion.price < price;
    steps.push({
      stage: 'promotion', source: `promotion:${selectedPromotion.promotion.id}`, before: price,
      after: applied ? selectedPromotion.price : price, applied,
      reason: applied ? `活动“${selectedPromotion.promotion.name}”与用户折扣互斥，采用更低价格` : `用户折扣价低于活动“${selectedPromotion.promotion.name}”`,
    });
    if (applied) {
      price = selectedPromotion.price;
      appliedSource = `promotion:${selectedPromotion.promotion.id}`;
    }
  }

  if (input.manualAdjustment) {
    const before = price;
    price = adjustedPrice(price, input.manualAdjustment);
    appliedSource = 'manual_adjustment';
    steps.push({
      stage: 'manual_adjustment', source: 'manual_adjustment', before, after: price, applied: true,
      reason: input.manualAdjustment.reason || '管理员人工报价调整',
    });
  }

  let minimumPriceApplied = false;
  if (validPrice(input.minimumSalePrice) && price < input.minimumSalePrice) {
    const before = price;
    price = money(input.minimumSalePrice);
    minimumPriceApplied = true;
    steps.push({
      stage: 'minimum_price', source: 'minimum_sale_price', before, after: price, applied: true,
      reason: '成交价格不得低于最低成交价',
    });
  }

  return { finalPrice: price, currency: input.currency || 'CNY', appliedSource, minimumPriceApplied, steps };
}
