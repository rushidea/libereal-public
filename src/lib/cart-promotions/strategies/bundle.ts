/**
 * 组合折扣策略（bundle）：组合内各品类都达到指定数量 → 组合内商品享受综合折扣。
 *
 * 规则语义：
 * - 组合要求由多个组合项组成（每个组合项 = 品牌（可选）+ 货号前缀 + 须满足件数）；
 * - 所有组合项都满足时触发；
 * - 折扣：percent = 组合内原价合计 × (1 - discountValue)（0.85 打 85 折）；
 *   fixed = 直接立减 discountValue 元（不超过组合内原价合计）；
 * - 优惠作用于组合内商品（不重复作用于其他规则命中的商品）。
 */
import type {
  BundleRuleConfig,
  CartLine,
  PriceAdjustment,
  RuleEvaluation,
  RuleStrategy,
} from '../types';

/** 判断购物车行是否属于组合内的某个组合项（促销标记行不计入，避免赠品/换购品虚增组合件数） */
function belongsToGroup(
  line: CartLine,
  group: BundleRuleConfig['items'][number],
): boolean {
  if (line.isQuickOrder) return false;
  if (line.promoMark) return false;
  if (group.brand && line.product.brand !== group.brand) return false;
  return group.terms.some((t) => line.product.catalogNumber.startsWith(t));
}

export const bundleStrategy: RuleStrategy<BundleRuleConfig> = {
  type: 'bundle',
  evaluate(config, ctx): Omit<RuleEvaluation, 'rule'> {
    // 逐组合项统计件数，任一不满足则不触发
    const counts = config.items.map((group) => {
      const count = ctx.items
        .filter((i) => belongsToGroup(i, group))
        .reduce((sum, i) => sum + i.quantity, 0);
      return { group, count };
    });
    const triggered = counts.every((c) => c.count >= c.group.quantity);
    const missing = counts.filter((c) => c.count < c.group.quantity);

    // 组合内商品原价合计（同一行只计入一次）
    const bundleLines = ctx.items.filter((i) =>
      counts.some((c) => belongsToGroup(i, c.group)),
    );
    const subtotal =
      Math.round(
        bundleLines.reduce((s, i) => s + (i.product.price ?? 0) * i.quantity, 0) * 100,
      ) / 100;

    const adjustments: PriceAdjustment[] = [];
    if (triggered && subtotal > 0) {
      const amount =
        config.discountKind === 'fixed'
          ? Math.min(config.discountValue, subtotal)
          : Math.round(subtotal * (1 - config.discountValue) * 100) / 100;
      if (amount > 0) {
        adjustments.push({
          ruleId: config.id,
          type: 'bundle',
          name: config.name,
          description: config.description,
          amount,
          meta: {
            subtotal,
            discountKind: config.discountKind,
            discountValue: config.discountValue,
          },
        });
      }
    }

    const summary = triggered
      ? `${config.name}：组合优惠已生效（立减 ¥${adjustments[0]?.amount.toFixed(2) ?? '0.00'}）`
      : `${config.name}：还差 ${missing
          .map((m) => `${m.group.terms.join('/')} ${m.group.quantity - m.count} 件`)
          .join('、')}`;

    return {
      active: true,
      triggered,
      summary,
      details: {
        counts: counts.map((c) => ({
          terms: c.group.terms,
          required: c.group.quantity,
          actual: c.count,
        })),
        subtotal,
      },
      adjustments,
    };
  },
};
