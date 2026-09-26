import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkNotifySign: vi.fn(),
  paymentAttemptFindUnique: vi.fn(),
  paymentAttemptUpdate: vi.fn(),
  orderUpdate: vi.fn(),
  orderUpdateMany: vi.fn(),
  orderFindUnique: vi.fn(),
  writeAuditLog: vi.fn(),
  applyOrderPointsDeduction: vi.fn(),
}));

vi.mock('@/lib/alipay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/alipay')>();
  return {
    ...actual,
    getAlipaySdk: () => ({
      config: { appId: '9021000000000000', sellerId: '2088000000000000' },
      sdk: { checkNotifySign: mocks.checkNotifySign },
    }),
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    paymentAttempt: { findUnique: mocks.paymentAttemptFindUnique },
    $transaction: async (
      callback: (tx: {
        paymentAttempt: { update: typeof mocks.paymentAttemptUpdate };
        order: { update: typeof mocks.orderUpdate; updateMany: typeof mocks.orderUpdateMany; findUnique: typeof mocks.orderFindUnique };
      }) => Promise<unknown>,
    ) => callback({
      paymentAttempt: { update: mocks.paymentAttemptUpdate },
      order: { update: mocks.orderUpdate, updateMany: mocks.orderUpdateMany, findUnique: mocks.orderFindUnique },
    }),
  },
}));

vi.mock('@/lib/audit', () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock('@/lib/points-checkout-service', () => ({ applyOrderPointsDeduction: mocks.applyOrderPointsDeduction }));

import { POST } from '@/app/api/payments/alipay/notify/route';

function notifyRequest(overrides: Record<string, string> = {}) {
  const body = new URLSearchParams({
    app_id: '9021000000000000',
    seller_id: '2088000000000000',
    out_trade_no: 'LPTEST001',
    total_amount: '0.30',
    trade_status: 'TRADE_SUCCESS',
    trade_no: '202607190001',
    sign_type: 'RSA2',
    sign: 'signed-value',
    ...overrides,
  });
  return new Request('https://libereal.cn/api/payments/alipay/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('Alipay payment notify route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkNotifySign.mockReturnValue(true);
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: 'attempt-1',
      outTradeNo: 'LPTEST001',
      amount: 0.1 * 3,
      paidAt: null,
      order: { id: 'order-1', total: 0.1 * 3, paidAt: null, status: 'unpaid' },
    });
    mocks.paymentAttemptUpdate.mockResolvedValue({});
    mocks.orderUpdate.mockResolvedValue({});
    mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
    mocks.orderFindUnique.mockResolvedValue({ status: 'pending', paidAt: new Date() });
    mocks.writeAuditLog.mockResolvedValue(undefined);
    mocks.applyOrderPointsDeduction.mockResolvedValue({ ok: true });
  });

  it('accepts a successful payment notification when rounded cents match the stored float amount', async () => {
    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('success');
    expect(mocks.paymentAttemptUpdate).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({
        status: 'paid',
        tradeNo: '202607190001',
      }),
    });
    expect(mocks.orderUpdateMany).toHaveBeenCalledWith({
      where: { id: 'order-1', paidAt: null, status: { in: ['unpaid', 'pending'] } },
      data: { paidAt: expect.any(Date), status: 'pending', autoCloseAt: null },
    });
    expect(mocks.orderUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        statusHistory: {
          create: expect.objectContaining({ fromStatus: 'unpaid', toStatus: 'pending', reason: 'alipay_paid' }),
        },
      }),
    }));
  });

  it('rejects a notification when the paid amount differs from the payment attempt', async () => {
    const response = await POST(notifyRequest({ total_amount: '0.29' }));

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe('fail');
    expect(mocks.paymentAttemptUpdate).not.toHaveBeenCalled();
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
  });

  it('does not credit a closed or cancelled Alipay order', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: 'attempt-1',
      outTradeNo: 'LPTEST001',
      amount: 0.3,
      paidAt: null,
      order: { id: 'order-1', total: 0.3, paidAt: null, status: 'closed' },
    });

    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('success');
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentAttemptUpdate).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({ status: 'rejected_order_cancelled' }),
    });
  });

  it('does not write a second payment event after the order has been claimed', async () => {
    mocks.orderUpdateMany.mockResolvedValue({ count: 0 });
    mocks.orderFindUnique.mockResolvedValue({ status: 'pending', paidAt: new Date() });

    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    expect(mocks.paymentAttemptUpdate).toHaveBeenCalled();
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it('rejects a late payment after the order was closed between notify reads', async () => {
    mocks.orderUpdateMany.mockResolvedValue({ count: 0 });
    mocks.orderFindUnique.mockResolvedValue({ status: 'closed', paidAt: null });

    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('success');
    expect(mocks.paymentAttemptUpdate).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({ status: 'rejected_order_cancelled' }),
    });
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'payment.alipay_rejected',
      after: expect.objectContaining({ reason: 'rejected_order_cancelled' }),
    }), expect.anything());
  });

  it('acknowledges payment and records pending settlement when legacy points cannot be deducted', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: 'attempt-1',
      outTradeNo: 'LPTEST001',
      amount: 0.3,
      paidAt: null,
      order: {
        id: 'order-1', total: 0.3, paidAt: null, status: 'unpaid',
        pointsApplied: false, pointsPersonal: 10, pointsGroup: 0,
      },
    });
    mocks.applyOrderPointsDeduction.mockResolvedValue({ ok: false, error: '个人积分不足' });

    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('success');
    expect(mocks.orderUpdateMany).toHaveBeenCalled();
    expect(mocks.applyOrderPointsDeduction).toHaveBeenCalledWith(expect.anything(), 'order-1');
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'payment.alipay_points_pending' }), expect.anything());
  });
});
