import { isPostDeliveryPaymentMethod } from '@/data/payment-methods';
import { isInactiveOrderStatus } from '@/lib/order-domain';

export function receivableOccupiesCredit(status: string | null | undefined): boolean {
  return status === 'open' || status === 'overdue';
}

/**
 * 后付订单结清，以及取消或关闭已占用授信的订单，归财务处理。
 * 发货、确认和其他未占用授信的状态变更仍归订单处理。
 */
export function orderStatusRequiresFinanceWrite(input: {
  currentStatus: string;
  nextStatus: unknown;
  paymentMethod: unknown;
  hasOpenReceivable: boolean;
}): boolean {
  if (typeof input.nextStatus !== 'string' || input.nextStatus === input.currentStatus) return false;
  if (!isPostDeliveryPaymentMethod(input.paymentMethod)) return false;
  if (input.nextStatus === 'completed') return true;
  return isInactiveOrderStatus(input.nextStatus)
    && !isInactiveOrderStatus(input.currentStatus)
    && input.hasOpenReceivable;
}
