import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminPointsMutation: vi.fn(),
  transaction: vi.fn(),
  writeAuditLog: vi.fn(),
  injectPersonalPoints: vi.fn(),
  injectGroupPoints: vi.fn(),
  tx: {
    user: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    researchGroup: {
      findUnique: vi.fn(),
    },
    pointsLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/admin-points-step-up', () => ({
  requireAdminPointsMutation: mocks.requireAdminPointsMutation,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock('@/lib/audit', () => ({
  writeAuditLog: mocks.writeAuditLog,
}));
vi.mock('@/lib/points-checkout-service', () => ({
  injectPersonalPoints: mocks.injectPersonalPoints,
  injectGroupPoints: mocks.injectGroupPoints,
}));

import { POST as adjustPOST } from '@/app/api/admin/points/adjust/route';
import { POST as injectPOST } from '@/app/api/admin/points/inject/route';

function request(url: string, body: object): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('积分调整完整性保护', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminPointsMutation.mockResolvedValue({ id: 'admin-1', email: 'admin@test.com' });
    mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
    mocks.tx.user.findUnique.mockResolvedValue({ id: 'user-1', points: 100, email: 'user@test.com' });
    mocks.tx.user.updateMany.mockResolvedValue({ count: 0 });
    mocks.tx.researchGroup.findUnique.mockResolvedValue({ id: 'group-1', points: 200 });
  });

  it('returns 409 when the optimistic-lock update finds a changed balance', async () => {
    const response = await adjustPOST(request('http://localhost/api/admin/points/adjust', {
      userId: 'user-1',
      delta: 50,
      reason: '并发测试',
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/其他操作修改/);
    expect(mocks.tx.pointsLog.create).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it('writes an independent audit record for personal injection', async () => {
    const response = await injectPOST(request('http://localhost/api/admin/points/inject', {
      targetType: 'personal',
      userId: 'user-1',
      points: 50,
      reason: '补偿积分',
    }));

    expect(response.status).toBe(200);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'points.injected',
      resource: 'points',
      targetType: 'User',
      targetId: 'user-1',
      before: { points: 100 },
      after: { points: 150 },
    }), mocks.tx);
  });

  it('rejects personal injection when the final balance exceeds the cap', async () => {
    mocks.tx.user.findUnique.mockResolvedValue({ id: 'user-1', points: 999950, email: 'user@test.com' });

    const response = await injectPOST(request('http://localhost/api/admin/points/inject', {
      targetType: 'personal',
      userId: 'user-1',
      points: 100,
    }));

    expect(response.status).toBe(400);
    expect(mocks.injectPersonalPoints).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it('rejects research-group injection when the final balance exceeds the cap', async () => {
    mocks.tx.researchGroup.findUnique.mockResolvedValue({ id: 'group-1', points: 999950 });

    const response = await injectPOST(request('http://localhost/api/admin/points/inject', {
      targetType: 'group',
      groupId: 'group-1',
      points: 100,
    }));

    expect(response.status).toBe(400);
    expect(mocks.injectGroupPoints).not.toHaveBeenCalled();
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });
});
