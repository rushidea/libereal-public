import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkNotifySign: vi.fn(),
  topupFindUnique: vi.fn(),
  topupUpdateMany: vi.fn(),
  groupUpdate: vi.fn(),
  groupLogCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/alipay', () => ({
  getAlipaySdk: () => ({
    config: { appId: '9021000000000000', sellerId: '2088000000000000' },
    sdk: { checkNotifySign: mocks.checkNotifySign },
  }),
  alipayAmountToCents: (value: number) => Math.round(value * 100),
  parseAlipayAmountCents: (value: string) => Math.round(Number(value) * 100),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pointsTopup: { findUnique: mocks.topupFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { POST } from '@/app/api/payments/alipay/notify/route';

function request() {
  const body = new URLSearchParams({
    app_id: '9021000000000000',
    seller_id: '2088000000000000',
    out_trade_no: 'PTTEST001',
    total_amount: '10.00',
    trade_status: 'TRADE_SUCCESS',
    trade_no: '202608100001',
    sign: 'signed-value',
  });
  return new Request('https://libereal.cn/api/payments/alipay/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('Alipay points top-up notify idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkNotifySign.mockReturnValue(true);
    mocks.topupFindUnique.mockResolvedValue({ id: 'topup-1', amount: 10, status: 'pending', targetType: 'group', groupId: 'group-1', points: 10, userId: 'user-1' });
    mocks.topupUpdateMany.mockResolvedValue({ count: 1 });
    mocks.groupUpdate.mockResolvedValue({});
    mocks.groupLogCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      pointsTopup: { updateMany: mocks.topupUpdateMany },
      researchGroup: { update: mocks.groupUpdate },
      groupPointsLog: { create: mocks.groupLogCreate },
    }));
  });

  it('credits the group only after atomically claiming the top-up', async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.topupUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'topup-1', status: { not: 'paid' } } }));
    expect(mocks.groupUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.groupLogCreate).toHaveBeenCalledTimes(1);
  });

  it('skips credit when another notification has claimed the top-up', async () => {
    mocks.topupUpdateMany.mockResolvedValue({ count: 0 });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.groupUpdate).not.toHaveBeenCalled();
    expect(mocks.groupLogCreate).not.toHaveBeenCalled();
  });
});
