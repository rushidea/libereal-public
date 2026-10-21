/**
 * 优惠券策略（coupon）：订单级满减券 / 无门槛券（落地 5）。
 *
 * 规则语义：
 * - 订单级优惠：调整无 catalogNumber（与 bundle 一致），作用于整单；
 * - threshold 券（满减券，stackable=false）：订单金额 ≥ threshold 时立减 discount 元，
 *   与其他券互斥（调用方每次仅评估一张券；多券同时提交由下单 API 拒绝）；
 * - 无门槛券（unrestricted，stackable=true）：无门槛直接立减 discount 元，
 *   可与其他优惠叠加（折上折再减）；
 * - 二次授权：模板 approvalStatus 与实例 issueApprovalStatus 均须 auto/approved 才可用；
 * - 券不可用（门槛不足/未授权/已过期/范围内无商品）→ triggered=false，无优惠。
 * - 适用范围：只统计范围内且未下架的商品小计；门槛与抵扣上限都用这个小计。
 *   促销标记行、快速下单行仍不计入。缺省范围视为全站。
 */
import {
  COUPON_SCOPE_EMPTY_MESSAGE,
  couponScopedLines,
  formatCouponScopeLabel,
  type CouponScope,
} from '@/lib/coupon-scope';
import type {
  CouponRuleConfig,
  PriceAdjustment,
  RuleEvaluation,
  RuleStrategy,
} from '../types';

function couponScope(config: CouponRuleConfig): CouponScope {
  return config.scope ?? { type: 'all' };
}

export const couponStrategy: RuleStrategy<CouponRuleConfig> = {
  type: 'coupon',
  evaluate(config, ctx): Omit<RuleEvaluation, 'rule'> {
    // 二次授权校验（模板 + 实例发放）
    const approved = ['auto', 'approved'].includes(config.approvalStatus)
      && ['auto', 'approved'].includes(config.issueApprovalStatus);
    if (!approved) {
      return {
        active: true,
        triggered: false,
        summary: `${config.name}：券尚未生效（待管理员授权）`,
        details: { reason: 'approval_pending', couponAmount: 0 },
        adjustments: [],
      };
    }

    // 范围内商品小计（排除促销标记行、快速下单行和已下架商品）
    const scope = couponScope(config);
    const scoped = couponScopedLines(ctx.items, scope);
    const subtotal = scoped.subtotal;
    const scopeLabel = formatCouponScopeLabel(scope);
    // 全站券且没有任何可计行（只剩赠品/换购）时，沿用原来的门槛/金额无效提示。
    // 其余「范围内一件都没有」（含只剩已下架商品）明确提示券不可用。
    if (scoped.inScopeCount === 0 && !(scope.type === 'all' && scoped.baseCount === 0)) {
      return {
        active: true,
        triggered: false,
        summary: `${config.name}：${COUPON_SCOPE_EMPTY_MESSAGE}`,
        details: { reason: 'out_of_scope', subtotal: 0, couponAmount: 0, scopeLabel },
        adjustments: [],
      };
    }

    // 满减门槛校验（按范围内小计）
    if (config.threshold > 0 && subtotal < config.threshold) {
      return {
        active: true,
        triggered: false,
        summary: `${config.name}：还差 ¥${(config.threshold - subtotal).toFixed(2)} 满减`,
        details: { subtotal, threshold: config.threshold, shortfall: Math.round((config.threshold - subtotal) * 100) / 100, couponAmount: 0 },
        adjustments: [],
      };
    }

    const amount = Math.min(config.discount, Math.round(subtotal * 100) / 100);
    if (amount <= 0) {
      return {
        active: true,
        triggered: false,
        summary: `${config.name}：优惠金额无效`,
        details: { subtotal, couponAmount: 0 },
        adjustments: [],
      };
    }

    const adjustments: PriceAdjustment[] = [{
      ruleId: config.id,
      type: 'coupon',
      name: config.name,
      description: config.description,
      amount,
      meta: {
        subtotal,
        threshold: config.threshold,
        discount: config.discount,
        stackable: config.stackable,
        code: config.code,
        scopeLabel,
      },
    }];

    return {
      active: true,
      triggered: true,
      summary: `${config.name}：已立减 ¥${amount.toFixed(2)}`,
      details: { subtotal, threshold: config.threshold, couponAmount: amount, stackable: config.stackable, scopeLabel },
      adjustments,
    };
  },
};
