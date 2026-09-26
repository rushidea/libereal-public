import { normalizeOrderPaymentMethod } from '@/data/payment-methods';

export const ORDER_STATUSES = [
  'unpaid',
  'pending',
  'confirmed',
  'partially_shipped',
  'shipped',
  'completed',
  'cancelled',
  'closed',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  unpaid: '未付款',
  pending: '待确认',
  confirmed: '已确认',
  partially_shipped: '部分发货',
  shipped: '已发货',
  completed: '已完成',
  cancelled: '已取消',
  closed: '关闭',
};

export const AUTO_CLOSEABLE_ORDER_STATUSES: readonly OrderStatus[] = ['unpaid', 'pending'];
export const INACTIVE_ORDER_STATUSES: readonly OrderStatus[] = ['cancelled', 'closed'];
export const ALIPAY_PAYABLE_ORDER_STATUSES: readonly OrderStatus[] = ['unpaid', 'pending', 'confirmed'];

const STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  unpaid: ['cancelled', 'closed'],
  pending: ['confirmed', 'cancelled', 'closed'],
  confirmed: ['partially_shipped', 'shipped', 'completed', 'cancelled'],
  partially_shipped: ['shipped', 'completed'],
  shipped: ['completed'],
  completed: [],
  cancelled: [],
  closed: [],
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && ORDER_STATUSES.includes(value as OrderStatus);
}

export function isInactiveOrderStatus(value: unknown): boolean {
  return value === 'cancelled' || value === 'closed';
}

export function isAutoCloseableOrderStatus(value: unknown): boolean {
  return value === 'unpaid' || value === 'pending';
}

export function initialOrderStatus(paymentMethod: unknown): OrderStatus {
  return normalizeOrderPaymentMethod(paymentMethod) === 'alipay' ? 'unpaid' : 'pending';
}

export function displayedOrderStatus(order: {
  status: string;
  paymentMethod?: string | null;
  paidAt?: Date | string | null;
}): string {
  if (
    isAutoCloseableOrderStatus(order.status)
    && normalizeOrderPaymentMethod(order.paymentMethod) === 'alipay'
    && !order.paidAt
  ) {
    return 'unpaid';
  }
  return order.status;
}

export function canCustomerCancelOrder(order: {
  status: string;
  paidAt?: Date | string | null;
  ownerScope?: string | null;
}): boolean {
  return order.ownerScope !== 'organization'
    && !order.paidAt
    && (order.status === 'unpaid' || order.status === 'pending' || order.status === 'confirmed');
}

export function requiresPaidAlipayRefund(
  nextStatus: unknown,
  paymentMethod: unknown,
  paidAt: Date | string | null | undefined,
): boolean {
  return (nextStatus === 'cancelled' || nextStatus === 'closed')
    && normalizeOrderPaymentMethod(paymentMethod) === 'alipay'
    && Boolean(paidAt);
}

export function canReorderFromOrderStatus(status: string): boolean {
  return status === 'cancelled' || status === 'closed';
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || STATUS_TRANSITIONS[from].includes(to);
}

export function assertOrderTransition(from: string, to: unknown): asserts to is OrderStatus {
  if (!isOrderStatus(from) || !isOrderStatus(to)) throw new Error('INVALID_ORDER_STATUS');
  if (!canTransitionOrder(from, to)) throw new Error('INVALID_ORDER_TRANSITION');
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateOrderAmounts(
  items: ReadonlyArray<{ unitPrice: number; quantity: number }>,
  adjustments: ReadonlyArray<{ amount: number }> = [],
) {
  const subtotal = money(items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0));
  const adjustmentTotal = money(adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0));
  const total = money(subtotal + adjustmentTotal);
  if (!Number.isFinite(total) || subtotal < 0 || total < 0) throw new Error('INVALID_ORDER_AMOUNT');
  return { subtotal, adjustmentTotal, total };
}

export function validateShipmentItems(
  orderItems: ReadonlyArray<{ id: string; quantity: number; shippedQty: number }>,
  shipmentItems: ReadonlyArray<{ orderItemId: string; quantity: number }>,
) {
  if (shipmentItems.length === 0) throw new Error('SHIPMENT_ITEMS_REQUIRED');
  const requested = new Map<string, number>();

  for (const item of shipmentItems) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('INVALID_SHIPMENT_QUANTITY');
    requested.set(item.orderItemId, (requested.get(item.orderItemId) || 0) + item.quantity);
  }

  for (const [orderItemId, quantity] of requested) {
    const orderItem = orderItems.find((item) => item.id === orderItemId);
    if (!orderItem) throw new Error('ORDER_ITEM_NOT_FOUND');
    if (orderItem.shippedQty + quantity > orderItem.quantity) throw new Error('SHIPMENT_QUANTITY_EXCEEDED');
  }

  return Array.from(requested, ([orderItemId, quantity]) => ({ orderItemId, quantity }));
}

export function fulfillmentStatus(items: ReadonlyArray<{ quantity: number; shippedQty: number }>): OrderStatus {
  if (items.length === 0 || items.every((item) => item.shippedQty === 0)) return 'confirmed';
  return items.every((item) => item.shippedQty >= item.quantity) ? 'shipped' : 'partially_shipped';
}
