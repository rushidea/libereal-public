import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  groupFindUnique: vi.fn(),
  logFindMany: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    researchGroup: { findUnique: mocks.groupFindUnique },
    groupPointsLog: { findMany: mocks.logFindMany },
  },
}));

import { GET } from '@/app/api/admin/research-groups/[id]/logs/route';

describe('GET /api/admin/research-groups/[id]/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' });
    mocks.groupFindUnique.mockResolvedValue({ id: 'group-1', name: '课题组 A' });
    mocks.logFindMany.mockResolvedValue([
      {
        id: 'log-1',
        delta: -10,
        type: 'order_redeem',
        reason: '订单积分抵扣',
        relatedId: 'order-1',
        adminEmail: null,
        createdAt: new Date('2026-08-09T00:00:00Z'),
        actor: { name: '成员 A', email: 'member@example.com' },
      },
    ]);
  });

  it('returns group ledger entries with actor context', async () => {
    const response = await GET(new Request('http://localhost/api/admin/research-groups/group-1/logs'), {
      params: Promise.resolve({ id: 'group-1' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      group: { id: 'group-1', name: '课题组 A' },
      logs: [{ actorName: '成员 A', relatedId: 'order-1' }],
    });
  });

  it('returns the admin authentication response unchanged', async () => {
    mocks.requireAdmin.mockResolvedValue(NextResponse.json({ error: '未授权' }, { status: 401 }));

    const response = await GET(new Request('http://localhost/api/admin/research-groups/group-1/logs'), {
      params: Promise.resolve({ id: 'group-1' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.groupFindUnique).not.toHaveBeenCalled();
  });
});
