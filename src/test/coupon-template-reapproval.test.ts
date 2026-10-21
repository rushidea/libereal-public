import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { buildCouponRule, redeemCoupon } from '@/lib/coupon-service';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));
vi.mock('@/lib/admin-mfa-settings', () => ({
  isAdminMfaScenarioEnabled: vi.fn(async () => false),
  requiresAdminMfaForPermission: vi.fn(async () => false),
}));

import { PATCH } from '@/app/api/admin/coupons/[id]/route';

const approvedAt = new Date('2026-10-01T00:00:00.000Z');

async function seedUnrestricted(code: string) {
  const coupon = await prisma.coupon.create({
    data: {
      name: '无门槛 50',
      type: 'unrestricted',
      threshold: 0,
      discount: 50,
      stackable: true,
      requiresApproval: true,
      approvalStatus: 'approved',
      approvedBy: 'approver-1',
      approvedAt,
      maxUses: 10,
      scopeType: 'all',
      scopeTargets: '[]',
      description: '原说明',
    },
  });
  await prisma.couponInstance.create({
    data: {
      couponId: coupon.id,
      userId: 'buyer-1',
      code,
      status: 'active',
      issueApprovalStatus: 'approved',
    },
  });
  return coupon;
}

function updateCoupon(id: string, body: Record<string, unknown>) {
  return PATCH(
    new Request(`http://localhost/api/admin/coupons/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'update', type: 'threshold', stackable: false, ...body }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe('PATCH /api/admin/coupons/[id] action=update', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    clearAllTables(getTestDb());
    seedAdmin(getTestDb());
  });

  it('returns an approved unrestricted coupon to pending when the discount changes and blocks redemption', async () => {
    const coupon = await seedUnrestricted('RESET-DISCOUNT');
    const response = await updateCoupon(coupon.id, { discount: 80 });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ approvalStatus: 'pending' });
    expect(await prisma.coupon.findUnique({ where: { id: coupon.id } })).toMatchObject({
      type: 'unrestricted',
      stackable: true,
      discount: 80,
      approvalStatus: 'pending',
      approvedBy: null,
      approvedAt: null,
    });
    expect(await prisma.couponInstance.findUnique({ where: { code: 'RESET-DISCOUNT' } })).toMatchObject({
      status: 'active',
      issueApprovalStatus: 'approved',
    });
    const redeemed = await prisma.$transaction((tx) => redeemCoupon(tx, 'RESET-DISCOUNT', 'buyer-1', 100));
    expect(redeemed).toEqual({ ok: false, error: '优惠券尚未生效（模板待授权）' });
    expect(await buildCouponRule('RESET-DISCOUNT')).toBeNull();
  });

  it('returns an approved unrestricted coupon to pending when the scope changes', async () => {
    const coupon = await seedUnrestricted('RESET-SCOPE');
    const response = await updateCoupon(coupon.id, { scopeType: 'brand', scopeTargets: ['Abcepta'] });

    expect(response.status).toBe(200);
    expect(await prisma.coupon.findUnique({ where: { id: coupon.id } })).toMatchObject({
      approvalStatus: 'pending',
      approvedBy: null,
      approvedAt: null,
      scopeType: 'brand',
      scopeTargets: '["Abcepta"]',
    });
    const redeemed = await prisma.$transaction((tx) => redeemCoupon(tx, 'RESET-SCOPE', 'buyer-1', 100));
    expect(redeemed).toMatchObject({ ok: false, error: '优惠券尚未生效（模板待授权）' });
  });

  it('returns an approved unrestricted coupon to pending when maxUses or validity changes', async () => {
    const uses = await seedUnrestricted('RESET-USES');
    expect((await updateCoupon(uses.id, { maxUses: 3 })).status).toBe(200);
    expect(await prisma.coupon.findUnique({ where: { id: uses.id } })).toMatchObject({
      approvalStatus: 'pending',
      approvedBy: null,
      maxUses: 3,
    });

    const expiry = await seedUnrestricted('RESET-EXPIRY');
    expect((await updateCoupon(expiry.id, { validDays: 7 })).status).toBe(200);
    const updated = await prisma.coupon.findUnique({ where: { id: expiry.id } });
    expect(updated?.approvalStatus).toBe('pending');
    expect(updated?.approvedAt).toBeNull();
    expect(updated?.validUntil).toBeInstanceOf(Date);
  });

  it('keeps approval when an unrestricted coupon only changes name or description', async () => {
    const coupon = await seedUnrestricted('KEEP-COPY');
    const response = await updateCoupon(coupon.id, { name: '新名字', description: '新说明', discount: 50 });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ approvalStatus: 'approved', message: '券模板已更新' });
    expect(await prisma.coupon.findUnique({ where: { id: coupon.id } })).toMatchObject({
      name: '新名字',
      description: '新说明',
      discount: 50,
      approvalStatus: 'approved',
      approvedBy: 'approver-1',
      approvedAt,
    });
    const redeemed = await prisma.$transaction((tx) => redeemCoupon(tx, 'KEEP-COPY', 'buyer-1', 100));
    expect(redeemed.ok).toBe(true);
  });

  it('keeps a threshold coupon approval when the discount changes', async () => {
    const coupon = await prisma.coupon.create({
      data: {
        name: '满 100 减 10',
        type: 'threshold',
        threshold: 100,
        discount: 10,
        stackable: false,
        requiresApproval: false,
        approvalStatus: 'auto',
        approvedBy: 'keeper',
        approvedAt,
        scopeType: 'all',
        scopeTargets: '[]',
      },
    });
    const response = await updateCoupon(coupon.id, { discount: 20, threshold: 120 });

    expect(response.status).toBe(200);
    expect(await prisma.coupon.findUnique({ where: { id: coupon.id } })).toMatchObject({
      type: 'threshold',
      stackable: false,
      discount: 20,
      threshold: 120,
      approvalStatus: 'auto',
      approvedBy: 'keeper',
      approvedAt,
    });
  });
});
