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

  it('hides points controls when an admin quote form turns the section off', () => {
    render(
      <CheckoutPaymentFields
        paymentMethod="bank_transfer"
        onPaymentMethodChange={() => {}}
        personalPoints={12}
        onPersonalPointsChange={() => {}}
        groupPoints={3}
        onGroupPointsChange={() => {}}
        pointsBalance={{ personalPoints: 20, group: null }}
        pointsDiscount={15}
        showPointsSection={false}
      />,
    );

    expect(screen.queryByRole('heading', { name: '积分抵扣' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('个人积分')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('课题组积分')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '对公转账' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '支付宝' })).toBeInTheDocument();
  });
});
