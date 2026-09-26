/**
 * 一口价策略（fixed-price）：主品按规格（spec）或货号享受指定固定价。
 *
 * 规则语义：
 * - 命中主品范围（brand + terms 前缀 / exactTerms 精确）的行：
 *   1. 先按「货号精确 + 规格」联合匹配 priceBySpec（term 存在时）——支持同规格异价（如 Annexin AP101 30T=269 vs AT101 30T=349）；
 *   2. 再按规格文本精确匹配 priceBySpec（term 缺省，全局规格价，如 EasyGo 48T/96T）；
 *   3. 再按货号前缀匹配 priceByTerm；
 *   4. 均未命中则无一口价（跳过）；
 * - 一口价 < 行价时产生优惠 = Σ (行价 - 一口价) × qty；
 * - 一口价 ≥ 行价时不产生优惠（不涨价）。
 *
 * 精确匹配防误伤：exactTerms 用「完整货号相等」匹配（如 Annexin 8 货号精确命中，
 * 不会误伤 AP101AVF/AP101PI/AT101C 等配件）；terms 前缀匹配保持原语义（EasyGo EK10 命中 EK101A）。
 */
import type {
  CartLine,
  FixedPriceRuleConfig,
  PriceAdjustment,
  RuleEvaluation,
  RuleStrategy,
} from '../types';

/** 规格归一化：小写、去空格（与库内 spec 宽容匹配） */
function normSpec(s: string) {
  return s.toLowerCase().replace(/\s/g, '');
}

/** 是否命中主品范围：exactTerms 精确优先，terms 前缀匹配（原语义） */
function inScope(config: FixedPriceRuleConfig, line: CartLine): boolean {
  if (config.exactTerms?.includes(line.product.catalogNumber)) return true;
  return config.terms.some((t) => line.product.catalogNumber.startsWith(t));
}

function lookupPrice(config: FixedPriceRuleConfig, line: CartLine): number | null {
  const spec = line.product.spec ?? line.product.catalogNumber;
  const cat = line.product.catalogNumber;
  const nSpec = normSpec(spec);
  // 1. 货号精确 + 规格联合匹配（Annexin 同规格异价场景）
  const byTermSpec = config.priceBySpec?.find(
    (s) => s.term && cat === s.term && normSpec(s.spec) === nSpec,
  );
  if (byTermSpec) return byTermSpec.price;
  // 2. 全局规格精确匹配（EasyGo 48T/96T 场景）
  const bySpec = config.priceBySpec?.find(
    (s) => !s.term && normSpec(s.spec) === nSpec,
  );
  if (bySpec) return bySpec.price;
  // 3. 货号前缀匹配
  const byTerm = config.priceByTerm?.find((t) => cat.startsWith(t.term));
  if (byTerm) return byTerm.price;
  // 4. 兜底：spec 包含关系（如「48T」包含在「48T/96T」中）
  const loose = config.priceBySpec?.find(
    (s) => !s.term && (nSpec.includes(normSpec(s.spec)) || normSpec(s.spec).includes(nSpec)),
  );
  if (loose) return loose.price;
  return null;
}

export const fixedPriceStrategy: RuleStrategy<FixedPriceRuleConfig> = {
  type: 'fixed-price',
  evaluate(config, ctx): Omit<RuleEvaluation, 'rule'> {
    const lines = ctx.items.filter(
      (i) =>
        !i.isQuickOrder &&
        !i.promoMark &&
        (!config.brand || i.product.brand === config.brand) &&
        inScope(config, i),
    );

    const adjustments: PriceAdjustment[] = [];
    let discountTotal = 0;
    for (const line of lines) {
      const fixed = lookupPrice(config, line);
      const original = line.product.price ?? 0;
      if (fixed == null || fixed <= 0 || fixed >= original) continue;
      const amount = Math.round((original - fixed) * line.quantity * 100) / 100;
      adjustments.push({
        lineId: line.id,
        ruleId: config.id,
        type: 'fixed-price',
        name: config.name,
        description: config.description,
        amount,
        catalogNumber: line.product.catalogNumber,
        meta: { qty: line.quantity, original, fixedPrice: fixed, name: line.product.name },
      });
      discountTotal += amount;
    }
    discountTotal = Math.round(discountTotal * 100) / 100;

    const hitCount = adjustments.length;
    const summary = hitCount > 0
      ? `${config.name}：${hitCount} 件商品一口价生效（立减 ¥${discountTotal.toFixed(2)}）`
      : `${config.name}：加入活动商品即可享受一口价`;

    return {
      active: true,
      triggered: hitCount > 0,
      summary,
      details: { hitCount, discountTotal },
      adjustments,
      // 独占锁：命中的主品行（fixed-price 调整即落在主品行）
      exclusiveLines: config.exclusive
        ? adjustments.map((a) => a.catalogNumber).filter((c): c is string => Boolean(c))
        : undefined,
    };
  },
};
