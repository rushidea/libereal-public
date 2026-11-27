/**
 * 买 N 免 M 策略（buy-n-get-m）：主品按单价降序排列，第 N、2N、3N… 位免单。
 *
 * 规则语义（Peter 确认，2026-08-05）：
 * - 主品范围内所有商品（按件展开）按价格降序排列；
 * - 每满 groupSize 件，其中价格最低的 freeCount 件免费；
 * - 例：买二送一（3 件免 1）→ 3 件时第 3 位（最低价）送；6 件时第 3、6 位送；
 * - 优惠 = Σ 免单件单价。
 */
import type {
  BuyNGetMRuleConfig,
  CartLine,
  PriceAdjustment,
  RuleEvaluation,
  RuleStrategy,
} from '../types';

/** 命中主品的购物车行（排除促销标记行） */
export function buyNGetMMainLines(items: CartLine[], config: BuyNGetMRuleConfig): CartLine[] {
  return items.filter(
    (i) =>
      !i.isQuickOrder &&
      !i.promoMark &&
      (!config.brand || i.product.brand === config.brand) &&
      config.terms.some((t) => i.product.catalogNumber.startsWith(t)),
  );
}

/** Exact free-unit allocation using the strategy's stable price ordering. */
export function getBuyNGetMFreeQuantities(items: CartLine[], config: BuyNGetMRuleConfig): Map<CartLine, number> {
  const lines = buyNGetMMainLines(items, config);
  const totalQty = lines.reduce((sum, line) => sum + line.quantity, 0);
  const groupSize = Math.max(1, config.groupSize);
  const freeCount = Math.max(1, config.freeCount ?? 1);
  const freeSlots = Math.floor(totalQty / groupSize) * freeCount;
  const expanded = lines.flatMap((line) => Array.from({ length: line.quantity }, () => ({ line, price: line.product.price ?? 0 })));
  expanded.sort((a, b) => b.price - a.price);
  const freeQuantities = new Map<CartLine, number>();
  for (let k = 1; k <= freeSlots; k++) {
    const index = k * groupSize - 1;
    if (index >= expanded.length) continue;
    const line = expanded[index].line;
    freeQuantities.set(line, (freeQuantities.get(line) ?? 0) + 1);
  }
  return freeQuantities;
}

export const buyNGetMStrategy: RuleStrategy<BuyNGetMRuleConfig> = {
  type: 'buy-n-get-m',
  evaluate(config, ctx): Omit<RuleEvaluation, 'rule'> {
    const lines = buyNGetMMainLines(ctx.items, config);
    const totalQty = lines.reduce((s, i) => s + i.quantity, 0);
    const groupSize = Math.max(1, config.groupSize);
    const freeCount = Math.max(1, config.freeCount ?? 1);
    // 免费名额 = 满组数 × 每组免单数（不设上限）
    const freeSlots = Math.floor(totalQty / groupSize) * freeCount;
    const triggered = freeSlots > 0;

    // 按件展开并按单价降序（单价相同保持稳定序）
    // The same allocation helper is used by unified checkout candidate construction.
    const freeQuantities = getBuyNGetMFreeQuantities(ctx.items, config);

    // 按货号汇总优惠（同一货号多件免单合并）
    const byLine = new Map<CartLine, number>();
    let discountTotal = 0;
    for (const line of lines) {
      const quantity = freeQuantities.get(line) ?? 0;
      const price = line.product.price ?? 0;
      if (!quantity) continue;
      byLine.set(line, quantity * price);
      discountTotal += quantity * price;
    }
    discountTotal = Math.round(discountTotal * 100) / 100;

    const adjustments: PriceAdjustment[] = [];
    for (const [line, amount] of byLine) {
      if (amount <= 0) continue;
      adjustments.push({
        lineId: line.id,
        ruleId: config.id,
        type: 'buy-n-get-m',
        name: config.name,
        description: config.description,
        amount: Math.round(amount * 100) / 100,
        catalogNumber: line.product.catalogNumber,
        meta: { qty: line.quantity, original: line.product.price ?? 0, free: true, name: line.product.name },
      });
    }

    const actualFreeSlots = [...freeQuantities.values()].reduce((sum, quantity) => sum + quantity, 0);
    const summary = triggered
      ? `${config.name}：已免单 ${Math.min(freeSlots, actualFreeSlots)} 件（立减 ¥${discountTotal.toFixed(2)}）`
      : `${config.name}：还差 ${groupSize - totalQty} 件可享买 ${groupSize - freeCount} 免 ${freeCount}`;

    return {
      active: true,
      triggered,
      summary,
      details: { totalQty, groupSize, freeCount, freeSlots: actualFreeSlots, discountTotal },
      adjustments,
      exclusiveLines: config.exclusive
        ? Array.from(byLine.keys()).map((l) => l.product.catalogNumber)
        : undefined,
    };
  },
};
