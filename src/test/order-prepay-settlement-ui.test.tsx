import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sessionState = {
  data: { user: { role: 'customer', email: 'q@test.com' } } as { user: { role: string; email: string } } | null,
  status: 'authenticated' as 'authenticated' | 'loading',
};

vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
}));

import OrderPrepaySettlement from '@/components/account/OrderPrepaySettlement';

describe('OrderPrepaySettlement', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionState.data = { user: { role: 'customer', email: 'q@test.com' } };
    sessionState.status = 'authenticated';
  });

  it('shows points and coupon controls without payment-method radios', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/points/balance')) {
        return new Response(JSON.stringify({ personalPoints: 40, group: null }), { status: 200 });
      }
      if (url.includes('/api/coupons')) {
        return new Response(JSON.stringify([{
          instanceId: 'inst',
          code: 'SAVE10',
          name: '满减券',
          type: 'threshold',
          threshold: 100,
          discount: 10,
        }]), { status: 200 });
      }
      return new Response(JSON.stringify({ total: 250, pointsDiscount: 40 }), { status: 200 });
    }));

    render(
      <OrderPrepaySettlement
        orderId="order-1"
        paymentMethod="alipay"
        personalPoints={0}
        groupPoints={0}
        couponCode=""
        onSettled={() => {}}
      />,
    );

    expect(screen.getByRole('heading', { name: '付款前选择积分和优惠券' })).toBeInTheDocument();
    expect(screen.getByLabelText('个人积分')).toBeInTheDocument();
    expect(screen.getByLabelText('优惠券码')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '支付宝' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '付款方式' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /满减券/ })).toBeInTheDocument();
    });
  });

  it('stays hidden for an admin session', () => {
    sessionState.data = { user: { role: 'admin', email: 'admin@test.com' } };
    render(
      <OrderPrepaySettlement
        orderId="order-1"
        paymentMethod="alipay"
        personalPoints={0}
        groupPoints={0}
        onSettled={() => {}}
      />,
    );
    expect(screen.queryByTestId('order-prepay-settlement')).not.toBeInTheDocument();
  });
});
