import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  orderFindUnique: vi.fn(),
  paymentAttemptCreate: vi.fn(),
  paymentAttemptFindFirst: vi.fn(),
  paymentAttemptFindUnique: vi.fn(),
  pageExecute: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ requireActiveSession: mocks.requireActiveSession }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    order: { findUnique: mocks.orderFindUnique },
    paymentAttempt: {
      create: mocks.paymentAttemptCreate,
      findFirst: mocks.paymentAttemptFindFirst,
      findUnique: mocks.paymentAttemptFindUnique,
    },
  },
}));
vi.mock('@/lib/audit', () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock('@/lib/alipay', () => ({
  alipayAmountToCents: (amount: number) => Math.round((amount + Number.EPSILON) * 100),
  formatAlipayAmount: (amount: number) => amount.toFixed(2),
  getAlipaySdk: () => ({
    config: { gateway: 'https://openapi-sandbox.dl.alipaydev.com/gateway.do' },
    sdk: { pageExecute: mocks.pageExecute },
  }),
}));

import { POST as createPayment } from '@/app/api/orders/[id]/alipay/route';
import { GET as redirectToAlipay } from '@/app/api/orders/[id]/alipay/redirect/route';

const user = { id: 'user-1', email: 'buyer@example.com', role: 'customer' };
const adminUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
const order = {
  id: 'order-1',
  email: user.email,
  total: 2259,
  paymentMethod: 'alipay',
  paidAt: null,
  status: 'pending',
  createdAt: new Date('2099-07-16T00:00:00.000Z'),
};

describe('Alipay order payment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.orderFindUnique.mockResolvedValue(order);
    mocks.paymentAttemptFindFirst.mockResolvedValue(null);
    mocks.paymentAttemptCreate.mockImplementation(async ({ data }) => ({ ...data }));
    mocks.writeAuditLog.mockResolvedValue(undefined);
  });

  it('creates a payment attempt and returns a same-origin redirect URL', async () => {
    const response = await createPayment(
      new Request('https://libereal.cn/api/orders/order-1/alipay', { method: 'POST' }),
      { params: Promise.resolve({ id: order.id }) },
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.redirectUrl).toMatch(
      /^\/api\/orders\/order-1\/alipay\/redirect\?attemptId=LP/,
    );
    expect(mocks.paymentAttemptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: order.id,
        provider: 'alipay',
        amount: order.total,
      }),
    });
  });

  it('reuses the existing unpaid Alipay trade number', async () => {
    mocks.paymentAttemptFindFirst.mockResolvedValue({
      orderId: order.id,
      provider: 'alipay',
      outTradeNo: 'LPREUSE001',
      amount: order.total,
      status: 'created',
    });

    const response = await createPayment(
      new Request('https://libereal.cn/api/orders/order-1/alipay', { method: 'POST' }),
      { params: Promise.resolve({ id: order.id }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      redirectUrl: '/api/orders/order-1/alipay/redirect?attemptId=LPREUSE001',
    }));
    expect(mocks.paymentAttemptCreate).not.toHaveBeenCalled();
  });

  it('reuses an attempt while the gateway reports WAIT_BUYER_PAY', async () => {
    mocks.paymentAttemptFindFirst.mockResolvedValue({
      orderId: order.id, provider: 'alipay', outTradeNo: 'LPWAIT001', amount: order.total, status: 'WAIT_BUYER_PAY',
    });

    const response = await createPayment(
      new Request('https://libereal.cn/api/orders/order-1/alipay', { method: 'POST' }),
      { params: Promise.resolve({ id: order.id }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      redirectUrl: '/api/orders/order-1/alipay/redirect?attemptId=LPWAIT001',
    }));
    expect(mocks.paymentAttemptCreate).not.toHaveBeenCalled();
  });

  it('rereads the active winner after a unique constraint race', async () => {
    const winner = { orderId: order.id, provider: 'alipay', outTradeNo: 'LPRACEWINNER', amount: order.total, status: 'created' };
    mocks.paymentAttemptFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    mocks.paymentAttemptCreate.mockRejectedValueOnce({ code: 'P2002' });

    const response = await createPayment(
      new Request('https://libereal.cn/api/orders/order-1/alipay', { method: 'POST' }),
      { params: Promise.resolve({ id: order.id }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      redirectUrl: '/api/orders/order-1/alipay/redirect?attemptId=LPRACEWINNER',
    }));
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it('preserves a mismatched active payment for explicit reconciliation', async () => {
    mocks.paymentAttemptFindFirst.mockResolvedValue({ id: 'stale', orderId: order.id, provider: 'alipay', outTradeNo: 'LPSTALE', amount: 12, status: 'WAIT_BUYER_PAY' });
    const response = await createPayment(new Request('https://example.test/api/orders/order-1/alipay', { method: 'POST' }), { params: Promise.resolve({ id: order.id }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
    expect(mocks.paymentAttemptCreate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it('accepts an unpaid order using the legacy zfb value', async () => {
    mocks.orderFindUnique.mockResolvedValue({ ...order, paymentMethod: 'zfb' });

    const response = await createPayment(
      new Request('https://libereal.cn/api/orders/order-1/alipay', { method: 'POST' }),
      { params: Promise.resolve({ id: order.id }) },
    );

    expect(response.status).toBe(200);
  });

  it('rejects Alipay payment after the 24-hour window', async () => {
    mocks.orderFindUnique.mockResolvedValue({
      ...order,
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
    });

    const response = await createPayment(
      new Request('https://libereal.cn/api/orders/order-1/alipay', { method: 'POST' }),
      { params: Promise.resolve({ id: order.id }) },
    );

    expect(response.status).toBe(410);
    expect(mocks.paymentAttemptCreate).not.toHaveBeenCalled();
  });

  it('rejects an administrator attempting to create payment for a customer order', async () => {
    mocks.requireActiveSession.mockResolvedValue(adminUser);

    const response = await createPayment(
      new Request('https://libereal.cn/api/orders/order-1/alipay', { method: 'POST' }),
      { params: Promise.resolve({ id: order.id }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.paymentAttemptCreate).not.toHaveBeenCalled();
  });

  it('redirects to a signed sandbox payment URL with callback URLs', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      orderId: order.id,
      provider: 'alipay',
      outTradeNo: 'LPTEST001',
      amount: order.total,
      status: 'created',
      order,
    });
    mocks.pageExecute.mockReturnValue(
      'https://openapi-sandbox.dl.alipaydev.com/gateway.do?method=alipay.trade.page.pay&app_id=9021000163604531&sign=signed',
    );

    const response = await redirectToAlipay(
      new Request(`https://libereal.cn/api/orders/${order.id}/alipay/redirect?attemptId=LPTEST001`),
      { params: Promise.resolve({ id: order.id }) },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://openapi-sandbox.dl.alipaydev.com/gateway.do?method=alipay.trade.page.pay&app_id=9021000163604531&sign=signed',
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.pageExecute).toHaveBeenCalledWith(
      'alipay.trade.page.pay',
      'GET',
      expect.objectContaining({
        returnUrl: `https://libereal.cn/payments/alipay/return?orderId=${order.id}`,
        notifyUrl: 'https://libereal.cn/api/payments/alipay/notify',
        bizContent: expect.objectContaining({
          out_trade_no: 'LPTEST001',
          total_amount: '2259.00',
          product_code: 'FAST_INSTANT_TRADE_PAY',
          qr_pay_mode: '1',
          timeout_express: '1d',
          time_expire: '2099-07-17 08:00:00',
        }),
      }),
    );
  });

  it('rejects payment attempts belonging to another customer', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      orderId: order.id,
      provider: 'alipay',
      outTradeNo: 'LPTEST002',
      amount: order.total,
      status: 'created',
      order: { ...order, email: 'other@example.com' },
    });

    const response = await redirectToAlipay(
      new Request(`https://libereal.cn/api/orders/${order.id}/alipay/redirect?attemptId=LPTEST002`),
      { params: Promise.resolve({ id: order.id }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.pageExecute).not.toHaveBeenCalled();
  });

  it('rejects an administrator attempting to redirect a customer payment', async () => {
    mocks.requireActiveSession.mockResolvedValue(adminUser);
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      orderId: order.id,
      provider: 'alipay',
      outTradeNo: 'LPTESTADMIN',
      amount: order.total,
      status: 'created',
      order,
    });

    const response = await redirectToAlipay(
      new Request(`https://libereal.cn/api/orders/${order.id}/alipay/redirect?attemptId=LPTESTADMIN`),
      { params: Promise.resolve({ id: order.id }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.pageExecute).not.toHaveBeenCalled();
  });

  it('returns a service error when Alipay request signing fails', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      orderId: order.id,
      provider: 'alipay',
      outTradeNo: 'LPTEST003',
      amount: order.total,
      status: 'created',
      order,
    });
    mocks.pageExecute.mockImplementation(() => {
      throw new Error('invalid private key');
    });

    const response = await redirectToAlipay(
      new Request(`https://libereal.cn/api/orders/${order.id}/alipay/redirect?attemptId=LPTEST003`),
      { params: Promise.resolve({ id: order.id }) },
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: '支付宝付款签名失败，请联系网站管理员',
      code: 'ALIPAY_SIGNING_FAILED',
    });
  });

  it('rejects a superseded attempt so an old link cannot create another payment', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      orderId: order.id, provider: 'alipay', outTradeNo: 'LPSUPERSEDED', amount: order.total,
      status: 'superseded', order,
    });

    const response = await redirectToAlipay(
      new Request(`https://libereal.cn/api/orders/${order.id}/alipay/redirect?attemptId=LPSUPERSEDED`),
      { params: Promise.resolve({ id: order.id }) },
    );

    expect(response.status).toBe(409);
    expect(mocks.pageExecute).not.toHaveBeenCalled();
  });
});
