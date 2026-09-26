import { describe, expect, it, vi } from 'vitest';
import { applyOrderPointsDeduction, previewPointsRedeem, refundOrderPointsProportionally } from '@/lib/points-checkout-service';

describe('points checkout service organization context', () => {
  it('only allows the current research-group member to use group points', async () => {
    const tx = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          points: 0,
          researchGroupMembership: {
            groupId: 'group-1',
            role: 'member',
            group: { id: 'group-1', name: '课题组一', points: 100, status: 'active', locked: true },
          },
        }),
      },
    };

    await expect(previewPointsRedeem(tx as never, 'user-1', 100, {
      personalPoints: 0,
      groupPoints: 10,
      groupId: 'group-2',
    })).resolves.toEqual({ ok: false, error: '当前账号不属于该课题组' });
  });

  it('records the organization on a group-points deduction log', async () => {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'order-1',
          customerId: 'user-1',
          pointsPersonal: 0,
          pointsGroup: 25,
          pointsGroupId: 'group-1',
          pointsDiscount: 25,
          pointsApplied: false,
          status: 'pending',
        }),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      researchGroup: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      groupPointsLog: { create: vi.fn() },
    };

    await expect(applyOrderPointsDeduction(tx as never, 'order-1')).resolves.toEqual({ ok: true });
    expect(tx.groupPointsLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ groupId: 'group-1', relatedId: 'order-1', delta: -25 }),
    });
  });

  it('keeps the organization context when group points are refunded', async () => {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'order-1',
          customerId: 'user-1',
          pointsPersonal: 0,
          pointsGroup: 25,
          pointsGroupId: 'group-1',
          pointsApplied: true,
          pointsRefundedPersonal: 0,
          pointsRefundedGroup: 0,
        }),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      researchGroup: { update: vi.fn() },
      groupPointsLog: { create: vi.fn() },
    };

    await expect(refundOrderPointsProportionally(tx as never, {
      orderId: 'order-1',
      refundYuan: 25,
      originalPaidYuan: 25,
    })).resolves.toMatchObject({ ok: true, group: 25 });
    expect(tx.groupPointsLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ groupId: 'group-1', relatedId: 'order-1', delta: 25 }),
    });
  });

  it('rejects a group-points refund when the historical order lacks a group id', async () => {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'order-1',
          customerId: 'user-1',
          pointsPersonal: 0,
          pointsGroup: 10,
          pointsGroupId: null,
          pointsApplied: true,
          pointsRefundedPersonal: 0,
          pointsRefundedGroup: 0,
        }),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      researchGroup: { update: vi.fn() },
      groupPointsLog: { create: vi.fn() },
    };

    await expect(refundOrderPointsProportionally(tx as never, {
      orderId: 'order-1',
      refundYuan: 10,
      originalPaidYuan: 10,
    })).resolves.toEqual({ ok: false, error: '订单缺少课题组' });
    expect(tx.groupPointsLog.create).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('rejects a refund claim when the order refund counters changed concurrently', async () => {
    const tx = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'order-1',
          customerId: 'user-1',
          pointsPersonal: 0,
          pointsGroup: 10,
          pointsGroupId: 'group-1',
          pointsApplied: true,
          pointsRefundedPersonal: 0,
          pointsRefundedGroup: 0,
        }),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      researchGroup: { update: vi.fn() },
      groupPointsLog: { create: vi.fn() },
    };

    await expect(refundOrderPointsProportionally(tx as never, {
      orderId: 'order-1',
      refundYuan: 10,
      originalPaidYuan: 10,
    })).resolves.toEqual({ ok: false, error: '退款状态已改变，请刷新后重试' });
    expect(tx.researchGroup.update).not.toHaveBeenCalled();
  });
});
