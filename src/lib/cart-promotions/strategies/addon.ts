/**
 * 换购策略（addon）：主品累计件数达到门槛 → 换购品按原价入车、结算时立减差额。
 *
 * 规则语义：
 * - 主品按件数混搭累计（命中 eligibleBrand + eligibleTerms 任一前缀）；
 * - 件数 >= minQuantity 即触发，每满 minQuantity 件可换购 1 件（不设上限）；
 * - 换购品按原价加入购物车，优惠金额 = Σ qty × (原价 - addonPrice)；
 * - 购物车中的换购行通过 promoMark.ruleId 关联本规则。
 */
import type {
  AddonRuleConfig,
  CartLine,
  PriceAdjustment,
  RuleEvaluation,
  RuleStrategy,
} from '../types';
import { isAddonProduct, isEligibleMainProduct } from '../matching';

/** 统计主品累计件数（混搭；排除促销标记行，避免赠品/换购品重复计入） */
function mainProductCount(items: CartLine[], config: AddonRuleConfig): number {
  return items
    .filter(
      (i) =>
        !i.isQuickOrder &&
        !i.promoMark &&
        isEligibleMainProduct(config, i.product),
    )
    .reduce((sum, i) => sum + i.quantity, 0);
}

/** 统计购物车中已用换购额度（件数）。 */
function usedQuota(items: CartLine[], ruleIds: ReadonlySet<string>): number {
  return items
    .filter((i) => !i.isQuickOrder && i.promoMark?.ruleId != null && ruleIds.has(i.promoMark.ruleId))
    .reduce((sum, i) => sum + i.quantity, 0);
}

export const addonStrategy: RuleStrategy<AddonRuleConfig> = {
  type: 'addon',
  evaluate(config, ctx): Omit<RuleEvaluation, 'rule'> {
    const mainCount = mainProductCount(ctx.items, config);
    const quota = Math.floor(mainCount / config.minQuantity) * (config.maxAddonsPerTrigger ?? 1);
    const sharedRuleIds = new Set(config.sharedQuotaGroup
      ? ctx.rules
        .filter((rule): rule is AddonRuleConfig => rule.type === 'addon' && rule.sharedQuotaGroup === config.sharedQuotaGroup)
        .map((rule) => rule.id)
      : [config.id]);
    const ownUsed = usedQuota(ctx.items, new Set([config.id]));
    const used = usedQuota(ctx.items, sharedRuleIds);
    const remainingQuota = Math.max(0, quota - used);
    const overSharedQuota = Boolean(config.sharedQuotaGroup && used > quota);
    const shortfall = mainCount >= config.minQuantity ? 0 : config.minQuantity - mainCount;
    const triggered = mainCount >= config.minQuantity;

    // 优惠明细：换购行立减 (原价 - addonPrice) × qty
    const adjustments: PriceAdjustment[] = [];
    // 同一共享组的已选换购品共同消耗额度；当前规则仅可使用未被其他类别占用的额度。
    let available = overSharedQuota
      ? 0
      : config.sharedQuotaGroup
        ? Math.max(0, quota - (used - ownUsed))
        : quota;
    for (const item of ctx.items) {
      if (item.isQuickOrder || item.promoMark?.ruleId !== config.id || !isAddonProduct(config, item.product)) continue;
      const quantity = Math.min(item.quantity, available);
      available -= quantity;
      if (quantity <= 0) continue;
      const original = item.product.price ?? 0;
      const perUnit = Math.max(0, original - config.addonPrice);
      if (perUnit > 0) {
        adjustments.push({
          lineId: item.id,
          ruleId: config.id,
          type: 'addon',
          name: config.name,
          description: config.description,
          amount: Math.round(perUnit * quantity * 100) / 100,
          catalogNumber: item.product.catalogNumber,
          meta: { qty: quantity, original, addonPrice: config.addonPrice, name: item.product.name },
        });
      }
    }

    const summary = triggered
      ? remainingQuota > 0
        ? `${config.name}：还可换购 ${remainingQuota} 件`
        : `${config.name}：换购额度已用完`
      : `${config.name}：还差 ${shortfall} 件可触发换购`;

    return {
      active: true,
      triggered,
      summary,
      details: { mainCount, quota, usedQuota: used, remainingQuota, shortfall, sharedQuotaGroup: config.sharedQuotaGroup, overSharedQuota },
      adjustments,
      // 独占锁：主品范围行
      exclusiveLines: config.exclusive
        ? ctx.items
            .filter(
              (i) =>
                !i.isQuickOrder &&
                !i.promoMark &&
                i.product.brand === config.eligibleBrand &&
                config.eligibleTerms.some((t) => i.product.catalogNumber.startsWith(t)),
            )
            .map((i) => i.product.catalogNumber)
        : undefined,
    };
  },
};
