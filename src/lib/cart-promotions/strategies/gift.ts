/**
 * 赠品策略（gift）：主品累计件数达到门槛 → 直接赠送指定产品（0 元）。
 *
 * 规则语义：
 * - 主品按件数累计（命中 eligibleBrand（可选）+ eligibleTerms（可选））；
 * - 件数 >= minQuantity 触发，每满 minQuantity 件送 maxGiftsPerTrigger 件（默认 1）；
 * - 赠品行以 promoMark.ruleId 关联本规则、promoMark.price = 0（免费）加入购物车；
 * - 优惠金额 = 赠品行原价全额（等于白送）。
 */
import type {
  CartLine,
  GiftRuleConfig,
  PriceAdjustment,
  RuleEvaluation,
  RuleStrategy,
} from '../types';
import { isGiftProduct } from '../matching';

/** 统计主品累计件数（按配置的品牌/货号条件过滤；均不配置 = 全部商品；排除促销标记行） */
function mainProductCount(items: CartLine[], config: GiftRuleConfig): number {
  return items
    .filter(
      (i) =>
        !i.isQuickOrder &&
        !i.promoMark &&
        (!config.eligibleBrand || i.product.brand === config.eligibleBrand) &&
        (!config.eligibleTerms?.length ||
          config.eligibleTerms.some((t) => i.product.catalogNumber.startsWith(t))),
    )
    .reduce((sum, i) => sum + i.quantity, 0);
}

/** 统计购物车中已加入的赠品行件数 */
function usedGifts(items: CartLine[], ruleId: string): number {
  return items
    .filter((i) => !i.isQuickOrder && i.promoMark?.ruleId === ruleId)
    .reduce((sum, i) => sum + i.quantity, 0);
}

export const giftStrategy: RuleStrategy<GiftRuleConfig> = {
  type: 'gift',
  evaluate(config, ctx): Omit<RuleEvaluation, 'rule'> {
    const mainLines = ctx.items.filter(
      (i) =>
        !i.isQuickOrder &&
        !i.promoMark &&
        (!config.eligibleBrand || i.product.brand === config.eligibleBrand) &&
        (!config.eligibleTerms?.length ||
          config.eligibleTerms.some((t) => i.product.catalogNumber.startsWith(t))),
    );

    // 按规格赠品表：逐行匹配规格，累加赠品额度（floor(qty/minQuantity) × giftQuantity）
    let giftQuota = 0;
    let mainCount = 0;
    let triggered = false;
    let shortfall = 0;
    if (config.specGifts?.length) {
      const specGifts = config.specGifts;
      for (const line of mainLines) {
        const spec = line.product.spec ?? line.product.catalogNumber;
        const norm = spec.toLowerCase().replace(/\s/g, '');
        const sg = specGifts.find((s) => s.spec.toLowerCase().replace(/\s/g, '') === norm)
          ?? specGifts.find((s) => norm.includes(s.spec.toLowerCase().replace(/\s/g, '')));
        if (!sg) continue;
        mainCount += line.quantity;
        giftQuota += Math.floor(line.quantity / sg.minQuantity) * sg.giftQuantity;
      }
      triggered = giftQuota > 0;
      shortfall = 0;
    } else {
      mainCount = mainProductCount(ctx.items, config);
      triggered = mainCount >= config.minQuantity;
      const perTrigger = config.maxGiftsPerTrigger ?? 1;
      giftQuota = triggered ? Math.floor(mainCount / config.minQuantity) * perTrigger : 0;
      shortfall = triggered ? 0 : config.minQuantity - mainCount;
    }

    const used = usedGifts(ctx.items, config.id);
    const remainingGifts = Math.max(0, giftQuota - used);

    // 优惠明细：赠品行按原价全额立减（免费 = 减掉原价）
    const adjustments: PriceAdjustment[] = [];
    let available = giftQuota;
    const identity = (line: CartLine) => `${line.product.brand}:${line.product.catalogNumber}:${line.product.spec ?? ''}`;
    const sameProductQuotas = new Map<string, number>();
    if (config.sameProduct) {
      for (const main of mainLines) {
        const key = identity(main);
        sameProductQuotas.set(key, (sameProductQuotas.get(key) ?? 0) + main.quantity);
      }
      for (const [key, quantity] of sameProductQuotas) {
        sameProductQuotas.set(key, Math.floor(quantity / config.minQuantity) * (config.maxGiftsPerTrigger ?? 1));
      }
    }
    for (const item of ctx.items) {
      if (item.isQuickOrder || item.promoMark?.ruleId !== config.id || !isGiftProduct(config, item.product)) continue;
      const quantity = Math.min(item.quantity, available, config.sameProduct ? (sameProductQuotas.get(identity(item)) ?? 0) : available);
      available -= quantity;
      if (config.sameProduct) sameProductQuotas.set(identity(item), (sameProductQuotas.get(identity(item)) ?? 0) - quantity);
      if (quantity <= 0) continue;
      const amount = Math.round((item.product.price ?? 0) * quantity * 100) / 100;
      if (amount > 0) {
        adjustments.push({
          lineId: item.id,
          ruleId: config.id,
          type: 'gift',
          name: config.name,
          description: config.description,
          amount,
          catalogNumber: item.product.catalogNumber,
          meta: { qty: quantity, original: item.product.price ?? 0, gift: true, name: item.product.name },
        });
      }
    }

    const summary = triggered
      ? remainingGifts > 0
        ? `${config.name}：还可领取赠品 ${remainingGifts} 件`
        : `${config.name}：赠品已全部加入`
      : `${config.name}：还差 ${shortfall} 件可领取赠品`;

    return {
      active: true,
      triggered,
      summary,
      details: { mainCount, giftQuota, usedGifts: used, remainingGifts, shortfall },
      adjustments,
      // 独占锁：主品范围行（exclusive 规则命中后这些行不参与其他促销）
      exclusiveLines: config.exclusive
        ? mainLines.map((i) => i.product.catalogNumber)
        : undefined,
    };
  },
};
