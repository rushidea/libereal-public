import { promotionEngine } from './engine';
import { isAddonProduct, isGiftProduct } from './matching';
import type { CartLine, RuleConfig } from './types';

/** 在共享计价层识别普通入车的附属品；保留原始行号用于展示和订单金额汇总。 */
export function assignAutomaticPromotions(input: CartLine[], rules: RuleConfig[], now: Date) {
  let lines = input.map((line, index) => ({ ...line, id: line.id ?? String(index) }));
  const originalIds = new Map(lines.map((line) => [line.id, line.id]));
  const active = promotionEngine.activeRules(rules, now)
    .filter((rule) => rule.type === 'addon' || rule.type === 'gift');
  const candidates = lines.flatMap((line) => {
    if (line.isQuickOrder || line.promoMark || !Number.isFinite(line.product.price) || (line.product.price ?? 0) <= 0) return [];
    return active.flatMap((rule) => {
      if (rule.type !== 'addon' && rule.type !== 'gift') return [];
      const matches = rule.type === 'addon' ? isAddonProduct(rule, line.product) : isGiftProduct(rule, line.product);
      const price = rule.type === 'addon' ? rule.addonPrice : 0;
      return matches && (line.product.price ?? 0) >= price
        ? [{ id: line.id, rule, price, saving: (line.product.price ?? 0) - price }] : [];
    });
  }).sort((a, b) => b.saving - a.saving || a.rule.id.localeCompare(b.rule.id) || a.id.localeCompare(b.id));

  for (const candidate of candidates) {
    const current = lines.find((line) => line.id === candidate.id && !line.promoMark);
    if (!current) continue;
    const markedId = `${current.id}:auto:${candidate.rule.id}`;
    const withQuantity = (quantity: number) => lines.flatMap((line) => line !== current ? [line] : [
      ...(line.quantity > quantity ? [{ ...line, quantity: line.quantity - quantity }] : []),
      { ...line, id: markedId, quantity, promoMark: { ruleId: candidate.rule.id, price: candidate.price } },
    ]);
    let low = 0;
    let high = current.quantity;
    while (low < high) {
      const quantity = Math.ceil((low + high) / 2);
      const evaluation = promotionEngine.evaluateAll(withQuantity(quantity), [candidate.rule], now)[0];
      const quota = Number(evaluation?.details?.[candidate.rule.type === 'gift' ? 'giftQuota' : 'quota'] ?? 0);
      const used = Number(evaluation?.details?.[candidate.rule.type === 'gift' ? 'usedGifts' : 'usedQuota'] ?? 0);
      const discounted = evaluation?.adjustments.reduce((sum, adjustment) => sum + Number(adjustment.meta?.qty ?? 0), 0) ?? 0;
      if (evaluation?.triggered && used <= quota && discounted >= used) low = quantity;
      else high = quantity - 1;
    }
    if (low > 0) {
      lines = withQuantity(low);
      originalIds.set(markedId, current.id);
    }
  }
  return { lines, originalIds };
}
