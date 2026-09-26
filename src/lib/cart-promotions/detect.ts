/**
 * 购物车促销检测（兼容层 + 统一入口）。
 *
 * 所有检测/计算均委托给规则引擎（engine.ts + strategies/*），
 * 此处保留旧函数签名（detectAddonEligibility / calcAddonDiscount 等），
 * 供既有调用方（结算页、购物车标记）零改动使用。
 *
 * 统一入口：evaluateCartPromotions(items) 返回全部规则评估结果（含赠品/组合折扣）。
 */
import type { CartItem, ProductCartItem } from '@/context/CartContext';
import { CART_ADDON_RULES, PROMOTION_RULES, type AddonPromotionRule } from './rules';
import { promotionEngine } from './engine';
import type { CartLine, RuleConfig, RuleEvaluation } from './types';
import { getEffectiveProductPrice, isPricedProduct } from '@/lib/product-pricing';
import { getRuleLifecycle } from './lifecycle';
import { getPromotionQualificationViews } from './qualification';
export type { PromotionQualificationView } from './qualification';
export { isEligibleMainProduct, isAddonProduct } from './matching';

/** 类型守卫：普通商品行（非快速下单行） */
function isProductCartItem(i: CartItem): i is ProductCartItem {
  return !i.isQuickOrder;
}

/** 适配：CartContext.CartItem → 引擎 CartLine（addon 标记映射为 promoMark） */
export function toCartLines(items: CartItem[]): CartLine[] {
  return items.filter(isProductCartItem).map((i, index) => ({
    id: String(index),
    product: {
      id: i.product.id,
      variantId: i.product.variantId,
      brand: i.product.brand,
      catalogNumber: i.product.catalogNumber,
      // 方案③：原始价剥离后回退到服务端预计算的展示价
      price: getEffectiveProductPrice(i.product),
      name: i.product.name,
      spec: i.product.spec ?? null,
    },
    quantity: i.quantity,
    isQuickOrder: i.isQuickOrder,
    promoMark: i.addon ? { ruleId: i.addon.ruleId, price: i.addon.addonPrice } : null,
  }));
}

export function isRuleActive(rule: AddonPromotionRule, now: Date = new Date()): boolean {
  return getRuleLifecycle(rule, now) === 'active';
}

/**
 * 促销页面的只读业务入口。数量来自购物车，未提交的页面数量不能另行累加。
 * 与购物车加入操作一致，仅有价普通商品贡献资格；保留加购行用于失效校验。
 * 返回值仅用于展示，订单预览及下单仍由服务端重新验证。
 */
export function getCartPromotionQualificationViews(items: CartItem[], now: Date = new Date()) {
  const participatingItems = items.filter((item) => !item.isQuickOrder
    && (item.addon || isPricedProduct(item.product)));
  return getPromotionQualificationViews(toCartLines(participatingItems), CART_ADDON_RULES, now);
}

export type AddonEligibility = {
  rule: AddonPromotionRule;
  /** 活动是否有效（启用 + 未过期） */
  active: boolean;
  /** 已触发（主品件数 >= minQuantity） */
  triggered: boolean;
  /** 购物车主品累计件数 */
  mainCount: number;
  /** 理论可换购件数 = floor(mainCount / minQuantity) */
  quota: number;
  /** 已用于换购的件数（购物车中的换购品件数） */
  usedQuota: number;
  /** 还可换购件数 */
  remainingQuota: number;
  /** 距触发还差几件（0 表示已触发） */
  shortfall: number;
};

export function canIncreasePromotionItem(item: ProductCartItem, evaluations: RuleEvaluation[]): boolean {
  if (!item.addon) return true;
  const evaluation = evaluations.find((entry) => entry.rule.id === item.addon!.ruleId);
  const remaining = evaluation?.details?.[evaluation.rule.type === 'gift' ? 'remainingGifts' : 'remainingQuota'];
  return Boolean(evaluation?.active && evaluation.triggered && Number(remaining ?? 0) > 0);
}

/** 兼容旧签名：仅换购规则的资格检测（内部走引擎） */
export function detectAddonEligibility(
  items: CartItem[],
  rules: AddonPromotionRule[] = CART_ADDON_RULES,
  now: Date = new Date(),
): AddonEligibility[] {
  const evals = promotionEngine.evaluateAll(toCartLines(items), rules, now);
  return evals.map((ev) => ({
    rule: ev.rule as AddonPromotionRule,
    active: ev.active,
    triggered: ev.triggered,
    mainCount: (ev.details?.mainCount as number) ?? 0,
    quota: (ev.details?.quota as number) ?? 0,
    usedQuota: (ev.details?.usedQuota as number) ?? 0,
    remainingQuota: (ev.details?.remainingQuota as number) ?? 0,
    shortfall: (ev.details?.shortfall as number) ?? 0,
  }));
}

/**
 * 兼容旧签名：换购优惠金额与明细（内部走引擎 adjustments）。
 */
export function calcAddonDiscount(
  items: CartItem[],
  eligibility: AddonEligibility[],
): {
  addonDiscount: number;
  lines: { catalogNumber: string; name: string; qty: number; original: number; discount: number }[];
} {
  const rules: RuleConfig[] = eligibility.map((e) => e.rule);
  const evals = promotionEngine.evaluateAll(toCartLines(items), rules);
  return summarizeAdjustments(evals);
}

/** 从评估结果汇总优惠明细（通用，供 /order 页渲染「优惠明细」区） */
export function summarizeAdjustments(
  evaluations: RuleEvaluation[],
): {
  addonDiscount: number;
  lines: { catalogNumber: string; name: string; qty: number; original: number; discount: number }[];
} {
  const lines: { catalogNumber: string; name: string; qty: number; original: number; discount: number }[] = [];
  let total = 0;
  for (const adj of promotionEngine.dedupeAdjustments(evaluations)) {
    const qty = (adj.meta?.qty as number) ?? 0;
    const original = (adj.meta?.original as number) ?? 0;
    lines.push({
      catalogNumber: adj.catalogNumber ?? '',
      name: (adj.meta?.name as string) ?? adj.name,
      qty,
      original,
      discount: adj.amount,
    });
    total += adj.amount;
  }
  return { addonDiscount: Math.round(total * 100) / 100, lines };
}

/**
 * 统一入口：评估购物车命中的所有营销规则（换购/赠品/组合折扣）。
 * 返回按活动类型分类的评估结果，供结算确认页渲染活动提示 + 优惠明细。
 */
export function evaluateCartPromotions(
  items: CartItem[],
  rules: RuleConfig[] = PROMOTION_RULES,
  now: Date = new Date(),
): RuleEvaluation[] {
  return promotionEngine.evaluateAll(toCartLines(items), rules, now);
}
