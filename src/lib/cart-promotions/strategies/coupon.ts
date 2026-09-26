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
 * - 券不可用（门槛不足/未授权/已过期）→ triggered=false，无优惠。
 */
import type {
  CouponRuleConfig,
  PriceAdjustment,
  RuleEvaluation,
  RuleStrategy,
} from '../types';

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

    // 订单金额 = 商品行小计（排除促销标记行：换购/赠品行不计入门槛）
    const subtotal = ctx.items
      .filter((i) => !i.isQuickOrder && !i.promoMark)
      .reduce((s, i) => s + (i.product.price ?? 0) * i.quantity, 0);

    // 满减门槛校验
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
      },
    }];

    return {
      active: true,
      triggered: true,
      summary: `${config.name}：已立减 ¥${amount.toFixed(2)}`,
      details: { subtotal, threshold: config.threshold, couponAmount: amount, stackable: config.stackable },
      adjustments,
    };
  },
};
