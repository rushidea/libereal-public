import { describe, expect, it } from 'vitest';
import {
  assertOrderTransition,
  calculateOrderAmounts,
  displayedOrderStatus,
  fulfillmentStatus,
  initialOrderStatus,
  requiresPaidAlipayRefund,
  validateShipmentItems,
} from '@/lib/order-domain';

describe('order domain', () => {
  it('allows defined order transitions and rejects terminal changes', () => {
    expect(() => assertOrderTransition('unpaid', 'cancelled')).not.toThrow();
    expect(() => assertOrderTransition('unpaid', 'closed')).not.toThrow();
    expect(() => assertOrderTransition('unpaid', 'pending')).toThrow('INVALID_ORDER_TRANSITION');
    expect(() => assertOrderTransition('unpaid', 'confirmed')).toThrow('INVALID_ORDER_TRANSITION');
    expect(() => assertOrderTransition('pending', 'confirmed')).not.toThrow();
    expect(() => assertOrderTransition('pending', 'closed')).not.toThrow();
    expect(() => assertOrderTransition('confirmed', 'cancelled')).not.toThrow();
    expect(() => assertOrderTransition('partially_shipped', 'cancelled')).toThrow('INVALID_ORDER_TRANSITION');
    expect(() => assertOrderTransition('shipped', 'cancelled')).toThrow('INVALID_ORDER_TRANSITION');
    expect(() => assertOrderTransition('completed', 'confirmed')).toThrow('INVALID_ORDER_TRANSITION');
    expect(() => assertOrderTransition('closed', 'pending')).toThrow('INVALID_ORDER_TRANSITION');
    expect(() => assertOrderTransition('pending', 'unknown')).toThrow('INVALID_ORDER_STATUS');
  });

  it('calculates subtotal, adjustments and total to cents', () => {
    expect(calculateOrderAmounts(
      [{ unitPrice: 10.115, quantity: 2 }],
      [{ amount: -1.23 }, { amount: 2 }],
    )).toEqual({ subtotal: 20.23, adjustmentTotal: 0.77, total: 21 });
  });

  it('rejects adjustments that make the order total negative', () => {
    expect(() => calculateOrderAmounts([{ unitPrice: 10, quantity: 1 }], [{ amount: -11 }]))
      .toThrow('INVALID_ORDER_AMOUNT');
  });

  it('combines duplicate shipment lines and prevents excess shipment', () => {
    const orderItems = [{ id: 'item-1', quantity: 4, shippedQty: 1 }];
    expect(validateShipmentItems(orderItems, [
      { orderItemId: 'item-1', quantity: 1 },
      { orderItemId: 'item-1', quantity: 2 },
    ])).toEqual([{ orderItemId: 'item-1', quantity: 3 }]);
    expect(() => validateShipmentItems(orderItems, [{ orderItemId: 'item-1', quantity: 4 }]))
      .toThrow('SHIPMENT_QUANTITY_EXCEEDED');
  });

  it('derives fulfillment status from shipped quantities', () => {
    expect(fulfillmentStatus([{ quantity: 2, shippedQty: 0 }])).toBe('confirmed');
    expect(fulfillmentStatus([{ quantity: 2, shippedQty: 1 }])).toBe('partially_shipped');
    expect(fulfillmentStatus([{ quantity: 2, shippedQty: 2 }])).toBe('shipped');
  });

  it('starts Alipay orders as unpaid and other methods as pending', () => {
    expect(initialOrderStatus('alipay')).toBe('unpaid');
    expect(initialOrderStatus('支付宝')).toBe('unpaid');
    expect(initialOrderStatus('bank_transfer')).toBe('pending');
    expect(initialOrderStatus('rjmart')).toBe('pending');
  });

  it('displays legacy unpaid Alipay pending orders as unpaid', () => {
    expect(displayedOrderStatus({ status: 'unpaid', paymentMethod: 'alipay', paidAt: null })).toBe('unpaid');
    expect(displayedOrderStatus({ status: 'pending', paymentMethod: 'alipay', paidAt: null })).toBe('unpaid');
    expect(displayedOrderStatus({ status: 'pending', paymentMethod: 'alipay', paidAt: new Date() })).toBe('pending');
    expect(displayedOrderStatus({ status: 'pending', paymentMethod: 'bank_transfer', paidAt: null })).toBe('pending');
  });

  it('requires a refund before cancelling or closing a paid Alipay order', () => {
    expect(requiresPaidAlipayRefund('closed', 'alipay', new Date())).toBe(true);
    expect(requiresPaidAlipayRefund('cancelled', 'alipay', new Date())).toBe(true);
    expect(requiresPaidAlipayRefund('closed', 'alipay', null)).toBe(false);
    expect(requiresPaidAlipayRefund('closed', 'bank_transfer', new Date())).toBe(false);
    expect(requiresPaidAlipayRefund('confirmed', 'alipay', new Date())).toBe(false);
  });
});
