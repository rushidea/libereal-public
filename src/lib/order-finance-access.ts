import { isPostDeliveryPaymentMethod } from '@/data/payment-methods';
import { isInactiveOrderStatus } from '@/lib/order-domain';

export function receivableOccupiesCredit(status: string | null | undefined): boolean {
  return status === 'open' || status === 'overdue';
}

/**
 * 取消或关闭已占用授信的后付订单需要财务权限。实际回款另行核销。
 */
export function orderStatusRequiresFinanceWrite(input: {
  currentStatus: string;
  nextStatus: unknown;
  paymentMethod: unknown;
  hasOpenReceivable: boolean;
}): boolean {
  if (typeof input.nextStatus !== 'string' || input.nextStatus === input.currentStatus) return false;
  if (!isPostDeliveryPaymentMethod(input.paymentMethod)) return false;
  return isInactiveOrderStatus(input.nextStatus)
    && !isInactiveOrderStatus(input.currentStatus)
    && input.hasOpenReceivable;
}
