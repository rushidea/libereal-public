/**
 * 折上折策略（stack-discount）：在行价（已含会员/品牌折扣等）基础上再打折扣。
 *
 * 与「互斥取最低」相反，这是**叠加型**折扣：
 * - 优惠 = Σ 行价 × (1 - discountRate) × qty（行价为服务端核定后的最终单价）。
 *
 * 注意：此策略的优惠金额基于「行价」计算，与固定价/买免按「原价」计算不同；
 * 服务端下单时行价 = 会员折扣后的单价，因此折上折实际叠乘在会员价之上。
 */
import type {
  PriceAdjustment,
  RuleEvaluation,
  RuleStrategy,
  StackDiscountRuleConfig,
} from '../types';

export const stackDiscountStrategy: RuleStrategy<StackDiscountRuleConfig> = {
  type: 'stack-discount',
  evaluate(config, ctx): Omit<RuleEvaluation, 'rule'> {
    const lines = ctx.items.filter(
      (i) =>
        !i.isQuickOrder &&
        !i.promoMark &&
        (!config.brand || i.product.brand === config.brand) &&
        config.terms.some((t) => i.product.catalogNumber.startsWith(t)),
    );
    const rate = config.discountRate;
    if (rate <= 0 || rate >= 1) {
      return { active: true, triggered: false, summary: `${config.name}：折扣率配置无效`, details: {}, adjustments: [] };
    }

    const adjustments: PriceAdjustment[] = [];
    let discountTotal = 0;
    for (const line of lines) {
      const price = line.product.price ?? 0;
      if (price <= 0) continue;
      const amount = Math.round(price * (1 - rate) * line.quantity * 100) / 100;
      if (amount <= 0) continue;
      adjustments.push({
        lineId: line.id,
        ruleId: config.id,
        type: 'stack-discount',
        name: config.name,
        description: config.description,
        amount,
        catalogNumber: line.product.catalogNumber,
        meta: { qty: line.quantity, price, discountRate: rate, name: line.product.name },
      });
      discountTotal += amount;
    }
    discountTotal = Math.round(discountTotal * 100) / 100;

    const summary = adjustments.length > 0
      ? `${config.name}：额外 ${Math.round((1 - rate) * 10)} 折生效（立减 ¥${discountTotal.toFixed(2)}）`
      : `${config.name}：加入活动商品即可享折上折`;

    return {
      active: true,
      triggered: adjustments.length > 0,
      summary,
      details: { hitCount: adjustments.length, discountRate: rate, discountTotal },
      adjustments,
      // 独占锁：折上折命中行（stackable 规则通常不设 exclusive，此处为完整性保留）
      exclusiveLines: config.exclusive
        ? adjustments.map((a) => a.catalogNumber).filter((c): c is string => Boolean(c))
        : undefined,
    };
  },
};
