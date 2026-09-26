import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  pointsLogFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  groupPointsLogFindMany: vi.fn(),
  getUserPointsBalance: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    pointsLog: { findMany: mocks.pointsLogFindMany },
    user: { findUnique: mocks.userFindUnique },
    groupPointsLog: { findMany: mocks.groupPointsLogFindMany },
  },
}));
vi.mock('@/lib/points-checkout-service', () => ({ getUserPointsBalance: mocks.getUserPointsBalance }));

import { GET } from '@/app/api/points/logs/route';

describe('GET /api/points/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: 'user-1' } });
    mocks.pointsLogFindMany.mockResolvedValue([]);
    mocks.userFindUnique.mockResolvedValue({ points: 80, tier: 'standard' });
    mocks.getUserPointsBalance.mockResolvedValue({
      personalPoints: 80,
      group: { id: 'group-1', name: '课题组 A', points: 120, status: 'active', locked: true, role: 'member', usable: true },
    });
    mocks.groupPointsLogFindMany.mockResolvedValue([
      {
        id: 'group-log-1',
        delta: -20,
        type: 'order_redeem',
        reason: '订单积分抵扣',
        relatedId: 'order-1',
        adminEmail: null,
        createdAt: new Date('2026-08-09T00:00:00Z'),
      },
    ]);
  });

  it('returns the current group ledger', async () => {
    const response = await GET(new NextRequest('http://localhost/api/points/logs'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      currentPoints: 80,
      groupLogs: [{ id: 'group-log-1', relatedId: 'order-1' }],
    });
    expect(mocks.groupPointsLogFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { groupId: 'group-1' },
    }));
  });

  it('does not query a group ledger when the account has no group', async () => {
    mocks.getUserPointsBalance.mockResolvedValue({ personalPoints: 80, group: null });

    const response = await GET(new NextRequest('http://localhost/api/points/logs'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ groupLogs: [] });
    expect(mocks.groupPointsLogFindMany).not.toHaveBeenCalled();
  });
});
