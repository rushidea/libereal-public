/**
 * 营销活动规则引擎核心。
 *
 * 职责：
 * 1. 持有策略注册表（type -> strategy），评估时按 rule.type 分发给对应策略；
 * 2. 过滤失效规则（disabled / 已过期）；
 * 3. 汇总全部优惠金额；
 * 4. 优惠合并（三级语义，落地 4）：
 *    - 独占型（exclusive=true）：命中该商品行的规则优惠保留，其他规则对该行的优惠全部剔除；
 *    - 叠加型（stackable=true）：该规则优惠全部保留（与其他规则叠加，不参与互斥竞争）；
 *    - 互斥取最低（默认）：同一货号被多个互斥规则命中时只保留优惠金额最大的一个
 *      （对应业务规则「多种折扣不可同时享受，取最低成交价」）。
 *    整单优惠（无 catalogNumber，如组合折扣）始终保留。
 *
 * 新增活动类型：新建 strategies/<type>.ts → 在 engine 底部 registerPromotionStrategies()
 * 里注册一行。引擎与结算页零改动。
 */
import type {
  CartLine,
  PriceAdjustment,
  RuleConfig,
  RuleEvaluation,
  RuleStrategy,
  RuleType,
} from './types';
import { addonStrategy } from './strategies/addon';
import { giftStrategy } from './strategies/gift';
import { bundleStrategy } from './strategies/bundle';
import { buyNGetMStrategy } from './strategies/buy-n-get-m';
import { fixedPriceStrategy } from './strategies/fixed-price';
import { stackDiscountStrategy } from './strategies/stack-discount';
import { couponStrategy } from './strategies/coupon';
import { getRuleLifecycle } from './lifecycle';

export class PromotionEngine {
  private strategies = new Map<RuleType, RuleStrategy>();

  /** 注册策略（同类型覆盖） */
  register<T extends RuleConfig>(strategy: RuleStrategy<T>): this {
    this.strategies.set(strategy.type, strategy as RuleStrategy);
    return this;
  }

  hasType(type: RuleType): boolean {
    return this.strategies.has(type);
  }

  /** 过滤有效规则（启用 + 未过期） */
  activeRules(rules: RuleConfig[], now: Date = new Date()): RuleConfig[] {
    return rules.filter((rule) => getRuleLifecycle(rule, now) === 'active');
  }

  /**
   * 评估全部规则。只评估有效规则，按类型分发给对应策略。
   * 未注册类型的规则会被跳过（安全降级）。
   */
  evaluateAll(items: CartLine[], rules: RuleConfig[], now: Date = new Date()): RuleEvaluation[] {
    const activeRules = this.activeRules(rules, now);
    const ctx = { items: items.map((item, index) => ({ ...item, id: item.id ?? String(index) })), now, rules: activeRules };
    const results: RuleEvaluation[] = [];
    for (const rule of activeRules) {
      const strategy = this.strategies.get(rule.type);
      if (!strategy) continue;
      const partial = strategy.evaluate(rule, ctx);
      results.push({ rule, ...partial });
    }
    return results;
  }

  /** 汇总全部优惠金额（已去重） */
  totalDiscount(evaluations: RuleEvaluation[]): number {
    return this.dedupeAdjustments(evaluations).reduce((s, a) => s + a.amount, 0);
  }

  /**
   * 优惠合并（三级语义）：
   * 1. 独占型规则（exclusive=true）的 exclusiveLines（主品行货号）→ 其他规则对这些货号的优惠全部剔除；
   * 2. 叠加型规则（stackable=true）的调整全部保留（不参与互斥竞争）；
   * 3. 互斥规则（默认）：同一货号被多个规则命中时只保留优惠最大的（取最低成交价）；
   * 4. 整单优惠（无 catalogNumber，如组合折扣）始终保留。
   */
  dedupeAdjustments(evaluations: RuleEvaluation[]): PriceAdjustment[] {
    // 1. 收集独占规则锁定的主品行货号
    const exclusiveLines = new Set<string>();
    for (const ev of evaluations) {
      if (!ev.rule.exclusive) continue;
      if (ev.exclusiveLines?.length) {
        for (const cat of ev.exclusiveLines) exclusiveLines.add(cat);
      } else {
        // 兜底：策略未提供 exclusiveLines 时退回调整行（fixed-price 等调整即主品行）
        for (const adj of ev.adjustments) {
          if (adj.catalogNumber) exclusiveLines.add(adj.catalogNumber);
        }
      }
    }

    const kept: PriceAdjustment[] = []; // 叠加型调整
    const global: PriceAdjustment[] = []; // 整单优惠
    const byLine = new Map<string, PriceAdjustment>(); // 互斥竞争（取最大）

    for (const ev of evaluations) {
      for (const adj of ev.adjustments) {
        if (!adj.catalogNumber) {
          // 整单优惠（组合折扣等）始终保留
          global.push(adj);
          continue;
        }
        if (ev.rule.stackable && !ev.rule.exclusive) {
          // 叠加型：全部保留
          kept.push(adj);
          continue;
        }
        if (!ev.rule.exclusive && exclusiveLines.has(adj.catalogNumber)) {
          // 该行被独占规则锁定，互斥/其他规则的优惠剔除
          continue;
        }
        // 互斥（默认）或独占规则自身：同货号取最大
        const key = adj.lineId ?? adj.catalogNumber;
        const prev = byLine.get(key);
        if (!prev || adj.amount > prev.amount) byLine.set(key, adj);
      }
    }
    return [...global, ...kept, ...byLine.values()];
  }
}

/** 全局单例引擎 */
export const promotionEngine = new PromotionEngine();

/** 注册内置策略（新增活动类型在此追加一行） */
export function registerPromotionStrategies(): void {
  promotionEngine
    .register(addonStrategy)
    .register(giftStrategy)
    .register(bundleStrategy)
    .register(buyNGetMStrategy)
    .register(fixedPriceStrategy)
    .register(stackDiscountStrategy)
    .register(couponStrategy);
}

// 模块加载即注册，保证任何调用方（页面/API/下单校验）拿到即用
registerPromotionStrategies();
