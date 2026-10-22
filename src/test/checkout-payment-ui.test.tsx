import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CheckoutPaymentFields } from '@/components/checkout/CheckoutPaymentFields';

describe('checkout payment fields', () => {
  afterEach(() => cleanup());

  it('offers the cart checkout methods, including Alipay and combined points', () => {
    render(
      <CheckoutPaymentFields
        paymentMethod="alipay"
        onPaymentMethodChange={() => {}}
        personalPoints={0}
        onPersonalPointsChange={() => {}}
        groupPoints={0}
        onGroupPointsChange={() => {}}
        pointsBalance={{ personalPoints: 20, group: null }}
        pointsDiscount={0}
      />,
    );

    expect(screen.getByRole('radio', { name: '对公转账' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '锐竞' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '喀斯玛' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '支付宝' })).toBeChecked();
    expect(screen.getByRole('heading', { name: '积分抵扣' })).toBeInTheDocument();
    expect(screen.getByLabelText('个人积分')).toBeInTheDocument();
  });
});
