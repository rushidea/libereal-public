import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { redeemCoupon, type CouponRedeemSnapshot } from '@/lib/coupon-service';

const coupon = { id: 'coupon-synthetic', name: 'Synthetic coupon', type: 'threshold',
  threshold: 100, discount: 10, stackable: false, scopeType: 'all', scopeTargets: '[]',
  approvalStatus: 'auto', validFrom: new Date('2020-01-01T00:00:00Z'), validUntil: null, maxUses: 0, usedCount: 0 };
const instance = { id: 'instance-synthetic', couponId: coupon.id, userId: 'synthetic-user',
  code: 'SYNTHETIC', status: 'active', issueApprovalStatus: 'auto', expiresAt: null, coupon };
const snapshot: CouponRedeemSnapshot = { instanceId: instance.id, couponId: instance.couponId,
  userId: instance.userId, instanceStatus: instance.status, issueApprovalStatus: instance.issueApprovalStatus,
  instanceExpiresAt: instance.expiresAt, type: coupon.type, threshold: coupon.threshold,
  discount: coupon.discount, stackable: coupon.stackable, scopeType: coupon.scopeType,
  scopeTargets: coupon.scopeTargets, approvalStatus: coupon.approvalStatus,
  validFrom: coupon.validFrom, validUntil: coupon.validUntil, maxUses: coupon.maxUses,
  scopedSubtotal: 150, previewedDiscount: 10 };

describe('coupon rule consistency', () => {
  it.each([{ discount: 20 }, { scopeType: 'product', scopeTargets: '[{"productId":"other"}]' }])(
    'rejects a rule changed after pre-evaluation: %j', async (change) => {
      const tx = { couponInstance: { findUnique: vi.fn().mockResolvedValue({ ...instance, coupon: { ...coupon, ...change } }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      coupon: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
      const result = await redeemCoupon(tx as unknown as Prisma.TransactionClient,
        'SYNTHETIC', 'synthetic-user', 150, 'synthetic-order', snapshot);
      expect(result).toEqual({ ok: false, error: '优惠券规则在结算期间发生变化，请重新确认' });
      expect(tx.couponInstance.updateMany).not.toHaveBeenCalled();
    },
  );
  it('uses conditional claims for the snapshot and allows an unchanged rule', async () => {
    const tx = { couponInstance: { findUnique: vi.fn().mockResolvedValue(instance), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      coupon: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const result = await redeemCoupon(tx as unknown as Prisma.TransactionClient, 'SYNTHETIC', 'synthetic-user', 150, 'synthetic-order', snapshot);
    expect(result).toMatchObject({ ok: true, adjustment: { amount: -10 } });
    expect(tx.couponInstance.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      couponId: coupon.id, userId: instance.userId, issueApprovalStatus: 'auto', expiresAt: null,
    }) }));
    expect(tx.coupon.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      discount: 10, threshold: 100, scopeType: 'all', scopeTargets: '[]', approvalStatus: 'auto',
    }) }));
  });
  it('rejects when the template changes after its read but before the conditional claim', async () => {
    const tx = { couponInstance: { findUnique: vi.fn().mockResolvedValue(instance), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      coupon: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const result = await redeemCoupon(tx as unknown as Prisma.TransactionClient, 'SYNTHETIC', 'synthetic-user', 150, 'synthetic-order', snapshot);
    expect(result.ok).toBe(false);
    expect(tx.coupon.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      discount: 10, scopeType: 'all', scopeTargets: '[]',
    }) }));
  });
});
