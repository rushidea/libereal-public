export type CheckoutFeePolicy = {
  platformRate: number;
  transferFee: number;
};

/** Merchant-specific checkout fees are supplied by deployment policy; public defaults add no fees. */
export const PUBLIC_CHECKOUT_FEE_POLICY: CheckoutFeePolicy = {
  platformRate: 0,
  transferFee: 0,
};

export function calculateCheckoutFeeAdjustments(
  subtotalAfterDiscounts: number,
  isThirdPartyPayment: boolean,
  policy: CheckoutFeePolicy = PUBLIC_CHECKOUT_FEE_POLICY,
) {
  if (!isThirdPartyPayment) return [];
  const adjustments: Array<{ type: 'platform_fee' | 'transfer_fee'; label: string; amount: number }> = [];
  if (policy.platformRate > 0) {
    adjustments.push({ type: 'platform_fee', label: 'Platform service fee', amount: Math.round(subtotalAfterDiscounts * policy.platformRate * 100) / 100 });
  }
  if (policy.transferFee > 0) {
    adjustments.push({ type: 'transfer_fee', label: 'Transfer fee', amount: policy.transferFee });
  }
  return adjustments;
}
