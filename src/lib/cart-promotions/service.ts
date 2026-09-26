/**
 * 购物车促销服务端辅助（下单 API / 定价预览 API 共用）。
 *
 * 统一入口：给定购物车行（CartLine[]，含 promoMark），
 * 评估全部活动 → 校验用评估结果 + 生成订单级负调整 + 汇总优惠总额。
 * 保证 /api/orders 与 /api/orders/pricing-preview 的优惠计算、平台费基准一致。
 */
import { PROMOTION_RULES } from './rules';
import { promotionEngine } from './engine';
import type { CartLine, GiftRuleConfig, RuleEvaluation } from './types';
import type { PriceLookupItem, VerifiedItem } from '@/lib/pricing';
import { isAddonProduct, isGiftProduct } from './matching';
import { isEligibleMainProduct } from './detect';
import { assignAutomaticPromotions } from './automatic';

export type PromotionIssue = { ruleId: string; message: string };

/** 预览与下单均使用数据库确认的商品身份，客户端仅提供活动选择。 */
export function toVerifiedCartLines(items: VerifiedItem[], submitted: PriceLookupItem[]): CartLine[] {
  return items.map((item, index) => ({
    id: String(index),
    product: {
      id: item.productId ?? '', brand: item.brand ?? '',
      catalogNumber: item.catalogNumber ?? '', spec: item.spec,
      name: item.name, price: item.unitPrice,
    },
    quantity: item.quantity,
    isQuickOrder: item.source !== 'db',
    promoMark: submitted[index]?.promoMark ?? null,
  }));
}

export function validatePromoMarks(lines: CartLine[], evaluations: RuleEvaluation[]): PromotionIssue[] {
  const issues = new Map<string, PromotionIssue>();
  for (const line of lines) {
    if (!line.promoMark) continue;
    const { ruleId, price } = line.promoMark;
    const evaluation = evaluations.find((entry) => entry.rule.id === ruleId);
    let message = '';
    if (!evaluation?.active || !['addon', 'gift'].includes(evaluation.rule.type)) {
      message = '促销活动失效，请移除加购商品后重新选择';
    } else if (line.isQuickOrder) {
      message = '加购商品价格需要重新确认，请移除后重新选择';
    } else {
      const rule = evaluation.rule;
      const expected = rule.type === 'addon' ? rule.addonPrice : 0;
      if (line.product.price == null || !Number.isFinite(line.product.price) || line.product.price < expected) {
        message = '加购商品价格需要重新确认，请移除后重新选择';
      } else if (price != null && (typeof price !== 'number' || !Number.isFinite(price) || Math.abs(price - expected) > 0.005)) {
        message = '加购价格发生变化，请移除加购商品后重新选择';
      } else if (evaluation.details?.overSharedQuota === true) {
        message = '本活动的换购额度已用完，请保留其中一件换购商品后重新结算';
      } else if ((rule.type === 'addon' && !isAddonProduct(rule, line.product))
        || (rule.type === 'gift' && !isGiftProduct(rule, line.product))) {
        message = '商品未参加所选加购活动，请移除后重新选择';
      } else {
        // 资格不足或超过额度时，本行保留原价；策略只会对可用额度生成优惠。
        // 购物车负责展示提示，订单服务端以相同结果完成最终计价。
      }
    }
    if (message) issues.set(ruleId, { ruleId, message });
  }
  return [...issues.values()];
}

export type PromoAdjustment = {
  type: `promotion_${string}`;
  label: string;
  amount: number; // 负数（立减）
  reason: string;
};

export type PromoComputation = {
  issues: PromotionIssue[];
  lineDiscounts: Record<string, number>;
  /** 活动优惠对应的商品行说明（原始购物车行 id → 活动名称） */
  linePromotionLabels: Record<string, string[]>;
  /** 全部规则的评估结果（供额度校验） */
  evals: RuleEvaluation[];
  /** 订单级负调整（换购/赠品/组合折扣） */
  adjustments: PromoAdjustment[];
  /** 优惠总额（正数） */
  discountTotal: number;
};

export type AddonValidationError =
  | 'PROMOTION_NOT_FOUND'
  | 'ADDON_NOT_TRIGGERED'
  | 'ADDON_QUOTA_EXCEEDED'
  | 'ADDON_PRODUCT_INVALID'
  | 'ADDON_PRICE_INVALID';

export type GiftValidationError =
  | 'PROMOTION_NOT_FOUND'
  | 'GIFT_NOT_TRIGGERED'
  | 'GIFT_QUOTA_EXCEEDED'
  | 'GIFT_PRODUCT_INVALID'
  | 'GIFT_PRICE_INVALID';

export function validateAddonPromotionLines(lines: CartLine[], evaluations: RuleEvaluation[]): AddonValidationError | null {
  for (const line of lines) {
    if (!line.promoMark) continue;
    const evaluation = evaluations.find((entry) => entry.rule.id === line.promoMark?.ruleId);
    if (!evaluation || !evaluation.active) return 'PROMOTION_NOT_FOUND';
    const addonRule = evaluation.rule;
    if (addonRule.type !== 'addon') continue;
    if (!evaluation.triggered) return 'ADDON_NOT_TRIGGERED';
    const quota = Number(evaluation.details?.quota ?? 0);
    const usedQuota = Number(evaluation.details?.usedQuota ?? 0);
    if (usedQuota > quota) return 'ADDON_QUOTA_EXCEEDED';
    const hasUnverifiedEligibleMain = lines.some((candidate) =>
      !candidate.promoMark && candidate.product.serverVerified === false
      && isEligibleMainProduct(addonRule, candidate.product));
    if (line.product.serverVerified === false || hasUnverifiedEligibleMain) return 'ADDON_PRODUCT_INVALID';
    if (!isAddonProduct(addonRule, line.product)) return 'ADDON_PRODUCT_INVALID';
    if (line.promoMark.price != null && Math.abs(line.promoMark.price - addonRule.addonPrice) > 0.005) {
      return 'ADDON_PRICE_INVALID';
    }
  }
  return null;
}

export function validateGiftPromotionLines(lines: CartLine[], evaluations: RuleEvaluation[]): GiftValidationError | null {
  for (const line of lines) {
    if (!line.promoMark) continue;
    const evaluation = evaluations.find((entry) => entry.rule.id === line.promoMark?.ruleId);
    if (!evaluation || !evaluation.active) return 'PROMOTION_NOT_FOUND';
    if (evaluation.rule.type !== 'gift') continue;
    const giftRule = evaluation.rule as GiftRuleConfig;
    if (!evaluation.triggered) return 'GIFT_NOT_TRIGGERED';
    const giftQuota = Number(evaluation.details?.giftQuota ?? 0);
    const usedGifts = Number(evaluation.details?.usedGifts ?? 0);
    if (!Number.isFinite(giftQuota) || !Number.isFinite(usedGifts) || usedGifts > giftQuota) return 'GIFT_QUOTA_EXCEEDED';
    if (line.product.serverVerified === false
      || (giftRule.giftBrand && line.product.brand !== giftRule.giftBrand)
      || !giftRule.giftTerms.some((term) => line.product.catalogNumber.startsWith(term))) return 'GIFT_PRODUCT_INVALID';
    if (line.promoMark.price !== 0) return 'GIFT_PRICE_INVALID';
  }
  return null;
}

export function computePromoAdjustments(
  lines: CartLine[],
  now: Date = new Date(),
): PromoComputation {
  const automatic = assignAutomaticPromotions(lines, PROMOTION_RULES, now);
  const evals = promotionEngine.evaluateAll(automatic.lines, PROMOTION_RULES, now);
  const issues = validatePromoMarks(lines, evals);
  const invalidRules = new Set(issues.map((issue) => issue.ruleId));
  const computed = promotionEngine
    .dedupeAdjustments(evals)
    .filter((a) => a.amount > 0 && !invalidRules.has(a.ruleId));
  const lineDiscounts: Record<string, number> = {};
  const linePromotionLabels: Record<string, string[]> = {};
  for (const adjustment of computed) {
    if (adjustment.lineId != null) {
      const originalId = automatic.originalIds.get(adjustment.lineId) ?? adjustment.lineId;
      lineDiscounts[originalId] = (lineDiscounts[originalId] ?? 0) + adjustment.amount;
      linePromotionLabels[originalId] ??= [];
      if (!linePromotionLabels[originalId].includes(adjustment.name)) {
        linePromotionLabels[originalId].push(adjustment.name);
      }
    }
  }
  const adjustments: PromoAdjustment[] = computed
    .map((a) => ({
      type: `promotion_${a.type}` as const,
      label: a.name,
      amount: -a.amount,
      reason: a.description,
  }));
  const discountTotal = adjustments.reduce((s, a) => s + -a.amount, 0);
  return {
    evals,
    adjustments,
    discountTotal: Math.round(discountTotal * 100) / 100,
    issues,
    lineDiscounts,
    linePromotionLabels,
  };
}
