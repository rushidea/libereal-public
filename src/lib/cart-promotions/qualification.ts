import { promotionEngine } from './engine';
import { getRuleLifecycle, type PromotionLifecycle } from './lifecycle';
import { isEligibleMainProduct } from './matching';
import { CART_ADDON_RULES } from './rules';
import { validatePromoMarks } from './service';
import type { AddonRuleConfig, CartLine } from './types';

export type PromotionLineView = Readonly<{
  productId: string;
  variantId: string | null;
  brand: string;
  catalogNumber: string;
  spec: string | null;
  quantity: number;
}>;

/**
 * Claude 展示组件与业务层之间的只读接口，仅支持当前 addon 换购规则。
 * 不包含规则匹配条件、库存猜测、内部价格或可提交的结算金额。
 */
export type PromotionQualificationView = Readonly<{
  ruleId: string;
  type: 'addon';
  lifecycle: PromotionLifecycle;
  status: 'unavailable' | 'expired' | 'not-qualified' | 'qualified' | 'limit-reached' | 'invalid-selection';
  /** 非有效活动未经引擎评估，资格数据为空，不能当成零额度。 */
  qualification: Readonly<{
    currentQuantity: number;
    thresholdQuantity: number;
    remainingQuantity: number;
    progressPercent: number;
    /** 同规则全部可选 SKU 共享此额度，不能给每个 SKU 分配独立额度。 */
    quota: number;
    selectedQuantity: number;
    remainingQuota: number;
  }> | null;
  qualifyingLines: readonly PromotionLineView[];
  selectedAddons: readonly PromotionLineView[];
  /** amount 是最终每件加购价，单位为元，不能再次从订单总额扣减。 */
  benefit: Readonly<{ kind: 'fixed_unit_price'; amount: number; currency: 'CNY' }>;
  /** 资格不等于库存；可选商品必须由 addon-products API 或商品服务提供。 */
  selectionAvailability: 'unknown';
  /** 仅表示允许进入选品步骤，不代表任何特定商品可以成交。 */
  canChooseAddon: boolean;
  issues: readonly Readonly<{ ruleId: string; message: string }>[];
}>;

function toLineView(line: CartLine): PromotionLineView {
  return Object.freeze({
    productId: line.product.id,
    variantId: line.product.variantId ?? null,
    brand: line.product.brand,
    catalogNumber: line.product.catalogNumber,
    spec: line.product.spec ?? null,
    quantity: line.quantity,
  });
}

/**
 * 从同一引擎投影资格。返回独立冻结快照，不修改购物车或暴露 RuleConfig。
 * 主品计数、门槛缺口、已用和剩余额度均来自策略评估，展示层无需重复计算。
 * lifecycle 沿用 enabled/validUntil；当前规则尚无开始时间，不能推断未开始状态。
 */
export function getPromotionQualificationViews(
  lines: CartLine[],
  rules: AddonRuleConfig[] = CART_ADDON_RULES,
  now: Date = new Date(),
): readonly PromotionQualificationView[] {
  const evaluations = promotionEngine.evaluateAll(lines, rules, now);
  const issues = validatePromoMarks(lines, evaluations);
  return Object.freeze(rules.map((rule): PromotionQualificationView => {
    const lifecycle = getRuleLifecycle(rule, now);
    const evaluation = evaluations.find((entry) => entry.rule.id === rule.id);
    const ruleIssues = Object.freeze(issues.filter((issue) => issue.ruleId === rule.id)
      .map((issue) => Object.freeze({ ...issue })));
    const qualification = evaluation ? Object.freeze({
      currentQuantity: Number(evaluation.details?.mainCount ?? 0),
      thresholdQuantity: rule.minQuantity,
      remainingQuantity: Number(evaluation.details?.shortfall ?? 0),
      progressPercent: Math.min(100, Math.max(0,
        Number(evaluation.details?.mainCount ?? 0) / rule.minQuantity * 100)),
      quota: Number(evaluation.details?.quota ?? 0),
      selectedQuantity: Number(evaluation.details?.usedQuota ?? 0),
      remainingQuota: Number(evaluation.details?.remainingQuota ?? 0),
    }) : null;
    const status = lifecycle === 'disabled' ? 'unavailable'
      : lifecycle === 'expired' ? 'expired'
        : ruleIssues.length ? 'invalid-selection'
          : !evaluation?.triggered ? 'not-qualified'
            : (qualification?.remainingQuota ?? 0) > 0 ? 'qualified' : 'limit-reached';

    return Object.freeze({
      ruleId: rule.id,
      type: 'addon',
      lifecycle,
      status,
      qualification,
      qualifyingLines: Object.freeze(lines.filter((line) => lifecycle === 'active'
        && !line.isQuickOrder && !line.promoMark && isEligibleMainProduct(rule, line.product))
        .map(toLineView)),
      selectedAddons: Object.freeze(lines.filter((line) => line.promoMark?.ruleId === rule.id).map(toLineView)),
      benefit: Object.freeze({ kind: 'fixed_unit_price', amount: rule.addonPrice, currency: 'CNY' }),
      selectionAvailability: 'unknown',
      canChooseAddon: status === 'qualified',
      issues: ruleIssues,
    });
  }));
}
