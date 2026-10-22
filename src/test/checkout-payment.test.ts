import { describe, expect, it } from 'vitest';
import { describeCheckoutPayable, paymentMethodAdjustments } from '@/lib/checkout-payment';

describe('checkout payment settlement helpers', () => {
  it('uses the same public third-party fee policy as cart checkout', () => {
    expect(paymentMethodAdjustments('rjmart', 300)).toEqual([]);
    expect(paymentMethodAdjustments('casmart', 300)).toEqual([]);
    expect(paymentMethodAdjustments('支付宝', 300)).toEqual([]);
    expect(paymentMethodAdjustments('对公转账', 300)).toEqual([]);
  });

  it('combines points with the payable amount after payment-method fees', () => {
    expect(describeCheckoutPayable({
      goodsSubtotal: 300,
      paymentMethod: 'casmart',
      personalPoints: 10,
      groupPoints: 5,
    })).toMatchObject({
      paymentMethod: 'casmart',
      payableBeforePoints: 300,
      pointsDiscount: 15,
      payable: 285,
    });
  });

  it('does not let requested points exceed the payable amount', () => {
    expect(describeCheckoutPayable({
      goodsSubtotal: 80,
      paymentMethod: 'alipay',
      personalPoints: 100,
    }).payable).toBe(0);
  });
});
