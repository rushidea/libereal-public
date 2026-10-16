import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  topupFindUnique: vi.fn(),
  pageExecute: vi.fn(),
  getAlipaySdk: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ requireActiveSession: mocks.requireActiveSession }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    pointsTopup: { findUnique: mocks.topupFindUnique },
  },
}));
vi.mock('@/lib/alipay', () => ({
  formatAlipayAmount: (amount: number) => amount.toFixed(2),
  getAlipaySdk: mocks.getAlipaySdk,
}));

import { GET as redirectToAlipay } from '@/app/api/points/topup/alipay/redirect/route';

const owner = { id: 'user-1', email: 'owner@example.com', role: 'customer', sessionId: 'session-1' };
const otherUser = { id: 'user-2', email: 'other@example.com', role: 'customer', sessionId: 'session-2' };

function redirectRequest(outTradeNo?: string) {
  const url = new URL('https://libereal.cn/api/points/topup/alipay/redirect');
  if (outTradeNo !== undefined) url.searchParams.set('outTradeNo', outTradeNo);
  return new NextRequest(url);
}

const pendingTopup = {
  id: 'topup-1',
  userId: owner.id,
  targetType: 'personal',
  points: 10,
  amount: 10,
  status: 'pending',
  outTradeNo: 'PTTEST001',
};

describe('Alipay points top-up redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AUTH_URL', 'https://libereal.cn');
    mocks.requireActiveSession.mockResolvedValue(owner);
    mocks.topupFindUnique.mockResolvedValue(pendingTopup);
    mocks.getAlipaySdk.mockReturnValue({
      sdk: { pageExecute: mocks.pageExecute },
    });
    mocks.pageExecute.mockReturnValue(
      'https://openapi-sandbox.dl.alipaydev.com/gateway.do?method=alipay.trade.page.pay&sign=signed',
    );
  });

  it('redirects the owning user to a signed Alipay payment URL', async () => {
    const response = await redirectToAlipay(redirectRequest('PTTEST001'));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://openapi-sandbox.dl.alipaydev.com/gateway.do?method=alipay.trade.page.pay&sign=signed',
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.topupFindUnique).toHaveBeenCalledWith({ where: { outTradeNo: 'PTTEST001' } });
    expect(mocks.pageExecute).toHaveBeenCalledWith(
      'alipay.trade.page.pay',
      'GET',
      expect.objectContaining({
        returnUrl: 'https://libereal.cn/account/points?topup=topup-1',
        notifyUrl: 'https://libereal.cn/api/payments/alipay/notify',
        bizContent: expect.objectContaining({
          out_trade_no: 'PTTEST001',
          total_amount: '10.00',
          subject: 'LIBEREAL 个人积分充值',
          product_code: 'FAST_INSTANT_TRADE_PAY',
        }),
      }),
    );
  });

  it('rejects a logged-in user who does not own the top-up', async () => {
    mocks.requireActiveSession.mockResolvedValue(otherUser);

    const response = await redirectToAlipay(redirectRequest('PTTEST001'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(mocks.pageExecute).not.toHaveBeenCalled();
  });

  it('rejects an administrator paying another user top-up', async () => {
    mocks.requireActiveSession.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
      sessionId: 'session-admin',
    });

    const response = await redirectToAlipay(redirectRequest('PTTEST001'));

    expect(response.status).toBe(403);
    expect(mocks.pageExecute).not.toHaveBeenCalled();
  });

  it('rejects a missing or inactive session before looking up the top-up', async () => {
    mocks.requireActiveSession.mockResolvedValue(NextResponse.json({ error: '未登录' }, { status: 401 }));

    const response = await redirectToAlipay(redirectRequest('PTTEST001'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: '未登录' });
    expect(mocks.topupFindUnique).not.toHaveBeenCalled();
    expect(mocks.pageExecute).not.toHaveBeenCalled();
  });

  it('does not start payment for a non-pending top-up owned by the current user', async () => {
    mocks.topupFindUnique.mockResolvedValue({ ...pendingTopup, status: 'paid' });

    const response = await redirectToAlipay(redirectRequest('PTTEST001'));

    expect(response.status).toBe(404);
    expect(mocks.pageExecute).not.toHaveBeenCalled();
  });

  it('requires an outTradeNo after the session check', async () => {
    const response = await redirectToAlipay(redirectRequest());

    expect(response.status).toBe(400);
    expect(mocks.topupFindUnique).not.toHaveBeenCalled();
    expect(mocks.pageExecute).not.toHaveBeenCalled();
  });
});
