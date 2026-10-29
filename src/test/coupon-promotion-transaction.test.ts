import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { buildCouponRule, redeemCoupon, type CouponRedeemSnapshot } from '@/lib/coupon-service';
import { revalidateCouponPromotionEvidence, verifyAndPriceItems, type CouponPromotionPricingEvidence } from '@/lib/pricing';
import { prisma } from '@/lib/prisma';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

const now = new Date('2026-10-29T12:00:00.000Z');
const previousPolicy = process.env.COUPON_PROMOTION_POLICY;
const policy = { state: 'restricted' as const, promotionIds: ['promo-policy'] };
const evidence: CouponPromotionPricingEvidence = {
  productId: 'product-1',
  variantId: null,
  pricedAt: now.toISOString(),
  identity: { state: 'restricted', promotionId: 'promo-policy' },
  product: { price: 100, promotionalPrice: null, minimumSalePrice: null },
  variant: null,
  candidates: [{
    bindingId: 'binding-1', productId: 'product-1', variantId: null, groupKey: 'main',
    promotion: {
      id: 'promo-policy', type: 'fixed_price', value: 80, ruleDefinition: null,
      ruleVersion: 1, status: 'active', startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-11-01T00:00:00.000Z', priority: 10, exclusive: true,
    },
  }],
};
const coupon = {
  id: 'coupon-1', name: 'Synthetic threshold coupon', type: 'threshold', threshold: 50,
  discount: 10, stackable: false, approvalStatus: 'auto', validFrom: new Date('2020-01-01T00:00:00.000Z'),
  validUntil: null, maxUses: 0, usedCount: 0, scopeType: 'all', scopeTargets: '[]',
};
const instance = {
  id: 'instance-1', couponId: coupon.id, userId: 'buyer-1', code: 'SYNTHETIC-PROMO',
  status: 'active', issueApprovalStatus: 'auto', expiresAt: null, coupon,
};

function snapshot(): CouponRedeemSnapshot {
  return {
    instanceId: instance.id, couponId: coupon.id, userId: instance.userId,
    instanceStatus: instance.status, issueApprovalStatus: instance.issueApprovalStatus,
    instanceExpiresAt: null, type: coupon.type, threshold: coupon.threshold, discount: coupon.discount,
    stackable: coupon.stackable, approvalStatus: coupon.approvalStatus, validFrom: coupon.validFrom,
    validUntil: null, maxUses: coupon.maxUses, scopeType: coupon.scopeType, scopeTargets: coupon.scopeTargets,
    scopedSubtotal: 100, previewedDiscount: 10,
    promotionPolicyFingerprint: JSON.stringify(policy), promotionPricingEvidence: [evidence],
  };
}

function txWithCandidates(candidates: typeof evidence.candidates) {
  const rows = candidates.map((candidate) => ({
    id: candidate.bindingId,
    productId: candidate.productId,
    variantId: candidate.variantId,
    groupKey: candidate.groupKey,
    promotion: {
      ...candidate.promotion,
      startsAt: new Date(candidate.promotion.startsAt),
      endsAt: new Date(candidate.promotion.endsAt),
    },
  }));
  return {
    couponInstance: {
      findUnique: vi.fn().mockResolvedValue(instance),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    coupon: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    product: { findUnique: vi.fn().mockResolvedValue({ id: 'product-1', price: 100, promotionalPrice: null, minimumSalePrice: null }) },
    productVariant: { findUnique: vi.fn() },
    promotionProduct: { findMany: vi.fn().mockResolvedValue(rows) },
  };
}

describe('transactional coupon promotion evidence', () => {
  afterEach(() => {
    if (previousPolicy === undefined) delete process.env.COUPON_PROMOTION_POLICY;
    else process.env.COUPON_PROMOTION_POLICY = previousPolicy;
  });

  it.each([
    ['candidate value changed', [{ ...evidence.candidates[0], promotion: { ...evidence.candidates[0].promotion, value: 75 } }]],
    ['new applicable binding inserted', [...evidence.candidates, {
      ...evidence.candidates[0], bindingId: 'binding-new', promotion: { ...evidence.candidates[0].promotion, id: 'promo-new' },
    }]],
  ])('rejects %s and rolls back the pending order before coupon claim', async (_description, candidates) => {
    process.env.COUPON_PROMOTION_POLICY = JSON.stringify(policy);
    const tx = txWithCandidates(candidates as typeof evidence.candidates);
    const state = { orderCreated: false };
    try {
      // Models the order route's transaction: the order write precedes coupon redemption,
      // and any failed redemption throws so the database transaction rolls the order back.
      state.orderCreated = true;
      const result = await redeemCoupon(tx as unknown as Prisma.TransactionClient,
        instance.code, instance.userId!, 100, 'order-pending', snapshot());
      if (!result.ok) throw new Error(result.error);
    } catch {
      state.orderCreated = false;
    }
    expect(state.orderCreated).toBe(false);
    expect(tx.couponInstance.updateMany).not.toHaveBeenCalled();
    expect(tx.coupon.updateMany).not.toHaveBeenCalled();
  });

  it('accepts an unchanged full candidate set at the same active-time boundary', async () => {
    process.env.COUPON_PROMOTION_POLICY = JSON.stringify(policy);
    const tx = txWithCandidates(evidence.candidates);
    const result = await redeemCoupon(tx as unknown as Prisma.TransactionClient,
      instance.code, instance.userId!, 100, 'order-pending', snapshot());
    expect(result).toMatchObject({ ok: true, adjustment: { amount: -10 } });
    expect(tx.promotionProduct.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId: 'product-1', variantId: null },
    }));
  });

  it('rejects a candidate whose active window ends between pricing and transaction time', async () => {
    const boundaryEvidence: CouponPromotionPricingEvidence = {
      ...evidence,
      pricedAt: '2026-10-28T12:00:00.000Z',
      candidates: [{
        ...evidence.candidates[0],
        promotion: { ...evidence.candidates[0].promotion, endsAt: '2026-10-29T00:00:00.000Z' },
      }],
    };
    const tx = txWithCandidates(boundaryEvidence.candidates);
    const stable = await revalidateCouponPromotionEvidence(
      tx as unknown as Prisma.TransactionClient,
      [boundaryEvidence],
      new Date('2026-10-29T00:00:00.000Z'),
    );
    expect(stable).toBe(false);
  });

  it('treats transaction evidence lookup failure as unknown before claiming the coupon', async () => {
    process.env.COUPON_PROMOTION_POLICY = JSON.stringify(policy);
    const tx = txWithCandidates(evidence.candidates);
    tx.product.findUnique.mockRejectedValue(new Error('synthetic database read failure'));
    const result = await redeemCoupon(tx as unknown as Prisma.TransactionClient,
      instance.code, instance.userId!, 100, 'order-pending', snapshot());
    expect(result).toEqual({ ok: false, error: '商品促销信息无法确认，请重新确认订单' });
    expect(tx.couponInstance.updateMany).not.toHaveBeenCalled();
    expect(tx.coupon.updateMany).not.toHaveBeenCalled();
  });
});

describe('checkout transaction rollback on promotion drift', () => {
  beforeAll(() => getTestDb());
  afterAll(async () => {
    await prisma.$disconnect();
    closeTestDb();
  });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedUser(db, { id: 'buyer-1', email: 'buyer@test.invalid' });
    db.prepare(`INSERT INTO Product (id, catalogNumber, name, brand, price, applications, reactivity, createdAt, updatedAt)
      VALUES ('product-1', 'SYNTH-1', 'Synthetic item', 'Synthetic', 100, '[]', '[]', datetime('now'), datetime('now'))`).run();
    db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, priority, exclusive, updatedAt)
      VALUES ('promo-policy', 'Synthetic active promotion', 'fixed_price', 80, 'active', ?, ?, 10, 1, datetime('now'))`)
      .run('2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
    db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId, variantId, groupKey)
      VALUES ('binding-1', 'promo-policy', 'product-1', NULL, 'main')`).run();
    db.prepare(`INSERT INTO Coupon (id, name, type, threshold, discount, stackable, approvalStatus, validFrom, maxUses, usedCount, scopeType, scopeTargets, updatedAt)
      VALUES ('coupon-1', 'Synthetic coupon', 'threshold', 50, 10, 0, 'auto', '2025-01-01T00:00:00.000Z', 0, 0, 'all', '[]', datetime('now'))`).run();
    db.prepare(`INSERT INTO CouponInstance (id, couponId, userId, code, status, issueApprovalStatus, createdAt, updatedAt)
      VALUES ('instance-1', 'coupon-1', 'buyer-1', 'SYNTHETIC-PROMO', 'active', 'auto', datetime('now'), datetime('now'))`).run();
    process.env.COUPON_PROMOTION_POLICY = JSON.stringify(policy);
  });

  afterEach(() => {
    if (previousPolicy === undefined) delete process.env.COUPON_PROMOTION_POLICY;
    else process.env.COUPON_PROMOTION_POLICY = previousPolicy;
  });

  it.each(['changed promotion value', 'new applicable candidate'])('rolls back the order when %s appears after pricing', async (drift) => {
    const priced = await verifyAndPriceItems([
      { productId: 'product-1', catalogNumber: 'SYNTH-1', brand: 'Synthetic', name: 'Synthetic item', price: 100, quantity: 1 },
    ], { now });
    expect(priced.verifiedItems[0].selectedPromotionId).toBe('promo-policy');
    expect(priced.verifiedItems[0].promotionPricingEvidence?.candidates).toHaveLength(1);

    const db = getTestDb();
    if (drift === 'changed promotion value') {
      db.prepare("UPDATE Promotion SET value = 75 WHERE id = 'promo-policy'").run();
    } else {
      db.prepare(`INSERT INTO Promotion (id, name, type, value, status, startsAt, endsAt, priority, exclusive, updatedAt)
        VALUES ('promo-new', 'Synthetic added candidate', 'fixed_price', 70, 'active', ?, ?, 20, 1, datetime('now'))`)
        .run('2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z');
      db.prepare(`INSERT INTO PromotionProduct (id, promotionId, productId, variantId, groupKey)
        VALUES ('binding-new', 'promo-new', 'product-1', NULL, 'main')`).run();
    }

    const built = await buildCouponRule('SYNTHETIC-PROMO');
    expect(built).not.toBeNull();
    const couponSnapshot = {
      ...built!.snapshot,
      scopedSubtotal: priced.verifiedSubtotal,
      previewedDiscount: 10,
      promotionPricingEvidence: priced.verifiedItems.map((item) => item.promotionPricingEvidence),
    } satisfies CouponRedeemSnapshot;
    await expect(prisma.$transaction(async (tx) => {
      await tx.order.create({ data: {
        id: 'order-rollback', email: 'buyer@test.invalid', customerId: 'buyer-1', subtotal: 80,
        adjustmentTotal: -10, total: 70, paymentMethod: 'bank_transfer',
      } });
      const redeemed = await redeemCoupon(tx, 'SYNTHETIC-PROMO', 'buyer-1', priced.verifiedSubtotal, 'order-rollback', couponSnapshot);
      if (!redeemed.ok) throw new Error(redeemed.error);
    })).rejects.toThrow('商品促销规则在结算期间发生变化，请重新确认');

    expect(await prisma.order.count({ where: { id: 'order-rollback' } })).toBe(0);
    expect(await prisma.couponInstance.findUnique({ where: { code: 'SYNTHETIC-PROMO' } })).toMatchObject({ status: 'active' });
    expect(await prisma.coupon.findUnique({ where: { id: 'coupon-1' } })).toMatchObject({ usedCount: 0 });
  });
});
