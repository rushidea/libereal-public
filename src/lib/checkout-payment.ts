import { isThirdPartyPaymentMethod, normalizeOrderPaymentMethod, type OrderPaymentMethod } from '@/data/payment-methods';
import { calculateCheckoutFeeAdjustments } from '@/lib/checkout-fees';

export type CheckoutAdjustment = {
  type: string;
  label: string;
  amount: number;
  reason?: string | null;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Payment-method fees follow the public checkout policy.
 * Deployment-specific rates stay in calculateCheckoutFeeAdjustments; this helper does not embed them.
 */
export function paymentMethodAdjustments(paymentMethod: unknown, netMerchandise: number): CheckoutAdjustment[] {
  const normalized = normalizeOrderPaymentMethod(paymentMethod);
  if (!normalized) return [];
  return calculateCheckoutFeeAdjustments(netMerchandise, isThirdPartyPaymentMethod(normalized));
}

export function describeCheckoutPayable(input: {
  goodsSubtotal: number;
  paymentMethod: unknown;
  personalPoints?: number;
  groupPoints?: number;
}) {
  const paymentMethod = normalizeOrderPaymentMethod(input.paymentMethod);
  const fees = paymentMethod ? paymentMethodAdjustments(paymentMethod, input.goodsSubtotal) : [];
  const feeTotal = roundMoney(fees.reduce((sum, fee) => sum + fee.amount, 0));
  const payableBeforePoints = roundMoney(input.goodsSubtotal + feeTotal);
  const requestedPoints = Math.max(0, Math.floor(input.personalPoints ?? 0)) + Math.max(0, Math.floor(input.groupPoints ?? 0));
  const pointsDiscount = Math.min(requestedPoints, Math.max(0, payableBeforePoints));
  return {
    paymentMethod,
    fees,
    payableBeforePoints,
    pointsDiscount,
    payable: roundMoney(payableBeforePoints - pointsDiscount),
  };
}

export function pointsRedeemAdjustment(breakdown: {
  personalPoints: number;
  groupPoints: number;
  pointsDiscount: number;
} | null | undefined): CheckoutAdjustment | null {
  if (!breakdown || breakdown.pointsDiscount <= 0) return null;
  return {
    type: 'points_redeem',
    label: '积分抵扣',
    amount: -breakdown.pointsDiscount,
    reason: [
      breakdown.personalPoints > 0 ? `个人 ${breakdown.personalPoints} 分` : null,
      breakdown.groupPoints > 0 ? `课题组 ${breakdown.groupPoints} 分` : null,
    ].filter(Boolean).join(' + ') || null,
  };
}

export function isCheckoutPaymentMethod(value: unknown): value is OrderPaymentMethod {
  return normalizeOrderPaymentMethod(value) != null;
}
