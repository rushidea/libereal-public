import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkNotifySign: vi.fn(),
  executeRaw: vi.fn(),
  paymentAttemptFindUnique: vi.fn(),
  paymentAttemptUpdate: vi.fn(),
  paymentAttemptUpdateMany: vi.fn(),
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
        $executeRawUnsafe: typeof mocks.executeRaw;
        paymentAttempt: {
          findUnique: typeof mocks.paymentAttemptFindUnique;
          update: typeof mocks.paymentAttemptUpdate;
          updateMany: typeof mocks.paymentAttemptUpdateMany;
        };
        order: { update: typeof mocks.orderUpdate; updateMany: typeof mocks.orderUpdateMany; findUnique: typeof mocks.orderFindUnique };
      }) => Promise<unknown>,
    ) => callback({
      $executeRawUnsafe: mocks.executeRaw,
      paymentAttempt: {
        findUnique: mocks.paymentAttemptFindUnique,
        update: mocks.paymentAttemptUpdate,
        updateMany: mocks.paymentAttemptUpdateMany,
      },
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
    mocks.executeRaw.mockResolvedValue(0);
    mocks.checkNotifySign.mockReturnValue(true);
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: 'attempt-1',
      outTradeNo: 'LPTEST001',
      amount: 0.1 * 3,
      status: 'created',
      paidAt: null,
      order: { id: 'order-1', total: 0.1 * 3, paidAt: null, status: 'unpaid' },
    });
    mocks.paymentAttemptUpdate.mockResolvedValue({});
    mocks.paymentAttemptUpdateMany.mockResolvedValue({ count: 1 });
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
      where: { id: 'order-1', total: 0.1 * 3, paidAt: null, status: { in: ['unpaid', 'pending'] } },
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
    expect(mocks.paymentAttemptUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'attempt-1' }),
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

  it('records a paid superseded attempt for reconciliation without settling the order', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: 'attempt-old',
      outTradeNo: 'LPTEST001',
      amount: 0.3,
      status: 'superseded',
      paidAt: null,
      order: { id: 'order-1', total: 0.3, paidAt: null, status: 'unpaid' },
    });

    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('success');
    expect(mocks.paymentAttemptUpdateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-old', status: 'superseded' },
      data: expect.objectContaining({ status: 'paid_superseded_reconciliation_required', tradeNo: '202607190001' }),
    });
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'payment.alipay_superseded_paid_reconciliation_required',
    }), expect.anything());
  });

  it('does not re-settle or re-audit a repeated superseded paid notification', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: 'attempt-old',
      outTradeNo: 'LPTEST001',
      amount: 0.3,
      status: 'paid_superseded_reconciliation_required',
      paidAt: new Date(),
      order: { id: 'order-1', total: 0.3, paidAt: null, status: 'unpaid' },
    });

    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('success');
    expect(mocks.paymentAttemptUpdate).not.toHaveBeenCalled();
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it('rejects a late payment after the order was closed between notify reads', async () => {
    mocks.orderUpdateMany.mockResolvedValue({ count: 0 });
    mocks.orderFindUnique.mockResolvedValue({ status: 'closed', paidAt: null });

    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('success');
    expect(mocks.paymentAttemptUpdateMany).toHaveBeenCalledWith({
      where: { id: 'attempt-1', status: 'created' },
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

  it('rechecks a concurrently superseded attempt before claiming the order', async () => {
    const active = {
      id: 'attempt-1', outTradeNo: 'LPTEST001', amount: 0.3, status: 'created', paidAt: null,
      order: { id: 'order-1', total: 0.3, paidAt: null, status: 'unpaid' },
    };
    const superseded = { ...active, status: 'superseded' };
    mocks.paymentAttemptFindUnique.mockResolvedValueOnce(active).mockResolvedValueOnce(superseded);

    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentAttemptUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'attempt-1', status: 'superseded' },
    }));
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it('rejects a payment when the order total changes before the transaction claim', async () => {
    const initial = {
      id: 'attempt-1', outTradeNo: 'LPTEST001', amount: 0.3, status: 'created', paidAt: null,
      order: { id: 'order-1', total: 0.3, paidAt: null, status: 'unpaid' },
    };
    const changed = { ...initial, order: { ...initial.order, total: 0.4 } };
    mocks.paymentAttemptFindUnique.mockResolvedValueOnce(initial).mockResolvedValueOnce(changed);

    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.paymentAttemptUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'rejected_amount_mismatch' }),
    }));
  });

  it('does not downgrade a paid attempt for a delayed non-paid callback', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: 'attempt-1', outTradeNo: 'LPTEST001', amount: 0.3, status: 'paid', paidAt: new Date(),
      order: { id: 'order-1', total: 0.3, paidAt: new Date(), status: 'pending' },
    });

    const response = await POST(notifyRequest({ trade_status: 'WAIT_BUYER_PAY' }));

    expect(response.status).toBe(200);
    expect(mocks.paymentAttemptUpdate).not.toHaveBeenCalled();
    expect(mocks.paymentAttemptUpdateMany).not.toHaveBeenCalled();
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
  });

  it('retries pending points for an already paid attempt without rewriting payment state', async () => {
    const paidAt = new Date();
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: 'attempt-1', outTradeNo: 'LPTEST001', amount: 0.3, status: 'paid', paidAt,
      order: {
        id: 'order-1', total: 0.3, paidAt, status: 'pending',
        pointsApplied: false, pointsPersonal: 10, pointsGroup: 0,
      },
    });
    mocks.applyOrderPointsDeduction.mockResolvedValue({ ok: false, error: '个人积分不足' });

    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    expect(mocks.applyOrderPointsDeduction).toHaveBeenCalledTimes(1);
    expect(mocks.paymentAttemptUpdate).not.toHaveBeenCalled();
    expect(mocks.paymentAttemptUpdateMany).not.toHaveBeenCalled();
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.orderUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1' },
      data: expect.objectContaining({ events: expect.anything() }),
    }));
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'payment.alipay_points_pending',
    }), expect.anything());
  });

  it('does not rewrite a paid attempt after the order is cancelled', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: 'attempt-1', outTradeNo: 'LPTEST001', amount: 0.3, status: 'paid', paidAt: new Date(),
      order: { id: 'order-1', total: 0.3, paidAt: new Date(), status: 'cancelled' },
    });

    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    expect(mocks.paymentAttemptUpdate).not.toHaveBeenCalled();
    expect(mocks.paymentAttemptUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it('audits superseded reconciliation only for the winning CAS', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: 'attempt-old', outTradeNo: 'LPTEST001', amount: 0.3, status: 'superseded', paidAt: null,
      order: { id: 'order-1', total: 0.3, paidAt: null, status: 'unpaid' },
    });
    mocks.paymentAttemptUpdateMany.mockResolvedValue({ count: 0 });

    const response = await POST(notifyRequest());

    expect(response.status).toBe(200);
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
  });
  it('returns a retryable failure when a points savepoint cannot be created', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({
      id: 'attempt-paid', outTradeNo: 'LPTEST001', amount: 0.3, status: 'paid', paidAt: new Date(),
      order: { id: 'order-1', total: 0.3, paidAt: new Date(), status: 'pending', pointsApplied: false, pointsPersonal: 10, pointsGroup: 0 },
    });
    mocks.executeRaw.mockRejectedValueOnce(new Error('synthetic savepoint failure'));
    const response = await POST(notifyRequest());
    expect(response.status).toBe(500);
    expect(mocks.applyOrderPointsDeduction).not.toHaveBeenCalled();
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it('does not reopen a closed attempt for a delayed waiting callback', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({ id: 'closed-attempt', outTradeNo: 'LPTEST001', amount: 0.3, status: 'TRADE_CLOSED', paidAt: null, order: { id: 'order-1', total: 0.3, paidAt: null, status: 'unpaid' } });
    expect((await POST(notifyRequest({ trade_status: 'WAIT_BUYER_PAY' }))).status).toBe(200);
    expect(mocks.paymentAttemptUpdate).not.toHaveBeenCalled();
    expect(mocks.paymentAttemptUpdateMany).not.toHaveBeenCalled();
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
  });
  it('records a late paid closed attempt for reconciliation without settling the order', async () => {
    mocks.paymentAttemptFindUnique.mockResolvedValue({ id: 'closed-attempt', outTradeNo: 'LPTEST001', amount: 0.3, status: 'TRADE_CLOSED', paidAt: null, order: { id: 'order-1', total: 0.3, paidAt: null, status: 'unpaid' } });
    expect((await POST(notifyRequest())).status).toBe(200);
    expect(mocks.paymentAttemptUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'closed-attempt', status: 'TRADE_CLOSED' }, data: expect.objectContaining({ status: 'paid_terminal_reconciliation_required' }) }));
    expect(mocks.orderUpdateMany).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'payment.alipay_terminal_paid_reconciliation_required' }), expect.anything());
  });

});
