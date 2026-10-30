import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  verifyAndPriceItems: vi.fn(),
  revalidateReferencePriceEvidence: vi.fn(),
  capturePromoLines: vi.fn(),
  userFindUnique: vi.fn(),
  orderFindFirst: vi.fn(),
  orderFindUnique: vi.fn(),
  orderCreate: vi.fn(),
  notificationCreate: vi.fn(),
  notificationFindMany: vi.fn(),
  getRequiredLegalConsent: vi.fn(),
  validateAcceptedLegalIds: vi.fn(),
  sendAdminOperationalEmail: vi.fn(),
  previewPointsRedeem: vi.fn(),
  applyOrderPointsDeduction: vi.fn(),
  requireActiveSession: vi.fn(),
}));
const sampleRules = vi.hoisted(() => ({ sample: { id: 'sample-addon-rule', type: 'addon' as const, name: 'Synthetic add-on offer', enabled: true, description: 'Synthetic fixture only.', eligibleBrand: 'Sample', eligibleTerms: ['SAMPLE-MAIN'], minQuantity: 6, addonPrice: 50, addonBrand: 'Sample', addonTerms: ['SAMPLE-ADDON'] } }));
vi.mock('@/lib/cart-promotions/rules', () => ({ PROMOTION_RULES: [sampleRules.sample], CART_ADDON_RULES: [sampleRules.sample], CART_GIFT_RULES: [], CART_BUNDLE_RULES: [] }));


vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/cart-promotions/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cart-promotions/service')>();
  return {
    ...actual,
    computePromoAdjustments: (lines: Parameters<typeof actual.computePromoAdjustments>[0], now?: Date) => {
      mocks.capturePromoLines(lines);
      return actual.computePromoAdjustments(lines, now);
    },
  };
});
vi.mock('@/lib/pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pricing')>();
  return {
    ...actual,
    verifyAndPriceItems: mocks.verifyAndPriceItems,
    revalidateReferencePriceEvidence: mocks.revalidateReferencePriceEvidence,
  };
});
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    order: {
      findFirst: mocks.orderFindFirst,
      findUnique: mocks.orderFindUnique,
      create: mocks.orderCreate,
    },
    notification: { create: mocks.notificationCreate, findMany: mocks.notificationFindMany },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      order: { create: mocks.orderCreate },
      notification: { create: mocks.notificationCreate },
    }),
  },
}));
vi.mock('@/lib/legal-documents', () => ({
  getRequiredLegalConsent: mocks.getRequiredLegalConsent,
  validateAcceptedLegalIds: mocks.validateAcceptedLegalIds,
}));
vi.mock('@/lib/mail', () => ({ sendAdminOperationalEmail: mocks.sendAdminOperationalEmail }));
vi.mock('@/lib/session', () => ({ requireActiveSession: mocks.requireActiveSession }));
vi.mock('@/lib/points-checkout-service', () => ({
  previewPointsRedeem: mocks.previewPointsRedeem,
  applyOrderPointsDeduction: mocks.applyOrderPointsDeduction,
}));
vi.mock('@/data/order-number', () => ({
  orderDateInShanghai: () => '20260723',
  nextOrderNumber: () => 'ORD-20260723-001',
  allocateOrderNumber: async () => 'ORD-20260723-001',
  ORDER_NUMBER_ALLOCATION_ATTEMPTS: 3,
  ORDER_NUMBER_BUSY_ERROR: '订单提交繁忙，请稍后重试',
  isUniqueConstraintError: (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002',
  isOrderIdUniqueConflict: (error: unknown) => {
    if (typeof error !== 'object' || error === null || !('code' in error) || (error as { code?: string }).code !== 'P2002') return false;
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    return Array.isArray(target) && target.map(String).includes('id');
  },
  withAllocatedOrderNumber: async (
    db: { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown> },
    run: (tx: unknown, orderId: string) => Promise<unknown>,
  ) => db.$transaction(async (tx) => run(tx, 'ORD-20260723-001')),
}));
vi.mock('@/lib/inventory', () => ({
  assertVariantCheckoutStock: vi.fn(),
  reserveOrderInventory: vi.fn(),
  isVariantStockInsufficientError: (error: unknown) => error instanceof Error && error.message === 'VARIANT_INSUFFICIENT_STOCK',
  VARIANT_STOCK_INSUFFICIENT: 'VARIANT_INSUFFICIENT_STOCK',
  VARIANT_STOCK_INSUFFICIENT_MESSAGE: '所选规格库存不足',
}));

import { POST } from '@/app/api/orders/route';
import { promotionLines, submittedPromotion, verifiedPromotion } from './cart-promotion-fixtures';
import { buildCheckoutRevision } from '@/lib/checkout-revision';
import { buildCheckoutRequestFingerprint } from '@/lib/checkout-idempotency';

function request(body: object) {
  return new Request('https://libereal.cn/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/orders', () => {

  function keyedRequest() {
    return { items: [{ productId: 'product-1', quantity: 1 }], paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'], checkoutAttemptId: 'synthetic-order-attempt' };
  }
  function replayRecord(body = keyedRequest()) {
    return { id: 'synthetic-existing', customerId: 'user-1', organizationId: null, ownerScope: 'personal', checkoutRequestFingerprint: buildCheckoutRequestFingerprint({ operation: 'order', actorId: 'user-1', organizationId: null, ownerScope: 'personal', request: body }) };
  }
  it('uses only verified promotion identity for order cart lines', async () => {
    const verified = verifiedPromotion();
    verified.verifiedItems[0].selectedPromotionId = 'trusted-promotion';
    verified.verifiedItems[0].promotionIdentity = { state: 'restricted', promotionId: 'trusted-promotion' };
    const submitted = submittedPromotion().map((item) => ({ ...item, selectedPromotionId: 'forged-promotion' }));
    mocks.verifyAndPriceItems.mockResolvedValue(verified);
    const response = await POST(request({
      items: submitted,
      paymentMethod: 'bank_transfer',
      acceptedLegalIds: ['checkout-terms'],
    }) as never);

    expect(response.status).toBe(200);
    const [lines] = mocks.capturePromoLines.mock.calls.at(-1) as [Array<{ product: { selectedPromotionId?: string | null; promotionIdentity?: unknown } }>];
    expect(lines.map((line) => line.product.selectedPromotionId)).toEqual(['trusted-promotion', null]);
    expect(lines.map((line) => line.product.promotionIdentity)).toEqual([
      { state: 'restricted', promotionId: 'trusted-promotion' }, { state: 'unknown' },
    ]);
  });
  it('revalidates reference-price activity inside a no-coupon order transaction', async () => {
    const priced = {
      verifiedSubtotal: 100, mismatchedCount: 0,
      verifiedItems: [{
        productId: 'product-1', catalogNumber: 'CAT-1', name: '测试产品', unitPrice: 100,
        quantity: 1, lineTotal: 100, pricingSnapshot: '{"finalPrice":100}', referencePriceApplied: true,
        promotionPricingEvidence: {
          productId: 'product-1', variantId: null, pricedAt: '2026-10-30T12:00:00.000Z',
          identity: { state: 'restricted' as const, promotionId: 'reference-campaign' },
          product: { price: 0, originalPrice: 1000, promotionalPrice: null, minimumSalePrice: null },
          variant: null, candidates: [], referencePricePromotionId: 'reference-campaign', referencePriceApplied: true,
        },
      }],
    };
    mocks.verifyAndPriceItems.mockResolvedValue(priced);
    const response = await POST(request({
      items: [{ productId: 'product-1', catalogNumber: 'CAT-1', name: '测试产品', price: 100, quantity: 1 }],
      paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'],
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.revalidateReferencePriceEvidence).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateReferencePriceEvidence).toHaveBeenCalledWith(
      expect.anything(), [priced.verifiedItems[0].promotionPricingEvidence], expect.any(Date),
    );
  });
  it('rejects a no-coupon order when reference-price evidence drifts in the transaction', async () => {
    const priced = {
      verifiedSubtotal: 100, mismatchedCount: 0,
      verifiedItems: [{
        productId: 'product-1', catalogNumber: 'CAT-1', name: '测试产品', unitPrice: 100,
        quantity: 1, lineTotal: 100, pricingSnapshot: '{"finalPrice":100}',
        referencePriceApplied: true, promotionPricingEvidence: { productId: 'product-1' } as never,
      }],
    };
    mocks.verifyAndPriceItems.mockResolvedValue(priced);
    mocks.revalidateReferencePriceEvidence.mockResolvedValue(false);
    const response = await POST(request({
      items: [{ productId: 'product-1', catalogNumber: 'CAT-1', name: '测试产品', price: 100, quantity: 1 }],
      paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'],
    }) as never);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'REFERENCE_PRICE_DRIFT' });
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });
  it('replays before price verification without duplicate order or notifications', async () => {
    mocks.orderFindUnique.mockResolvedValue(replayRecord());
    const response = await POST(request(keyedRequest()) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orderId: 'synthetic-existing', replayed: true });
    expect(mocks.verifyAndPriceItems).not.toHaveBeenCalled();
    expect(mocks.orderCreate).not.toHaveBeenCalled();
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
    expect(mocks.applyOrderPointsDeduction).not.toHaveBeenCalled();
  });
  it.each(['owner', 'intent'])('rejects a keyed %s conflict without pricing or writes', async (kind) => {
    mocks.orderFindUnique.mockResolvedValue(kind === 'owner' ? { ...replayRecord(), customerId: 'other-actor' } : { ...replayRecord(), checkoutRequestFingerprint: 'different-intent' });
    expect((await POST(request(keyedRequest()) as never)).status).toBe(409);
    expect(mocks.verifyAndPriceItems).not.toHaveBeenCalled();
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });
  it('rereads a unique-insert winner without sending another notification', async () => {
    mocks.orderFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(replayRecord());
    mocks.orderCreate.mockRejectedValueOnce({ code: 'P2002' });
    const response = await POST(request(keyedRequest()) as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orderId: 'synthetic-existing', replayed: true });
    expect(mocks.orderCreate).toHaveBeenCalledTimes(1);
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
    expect(mocks.sendAdminOperationalEmail).not.toHaveBeenCalled();
  });
  it('authenticates before looking up a replay key', async () => {
    const { NextResponse } = await import('next/server');
    mocks.requireActiveSession.mockResolvedValue(NextResponse.json({ error: 'Authentication required' }, { status: 401 }));
    expect((await POST(request(keyedRequest()) as never)).status).toBe(401);
    expect(mocks.orderFindUnique).not.toHaveBeenCalled();
  });

  it.each(['bank_transfer', 'rjmart'])('计算合成加购价并验证平台费用 %s', async (paymentMethod) => {
    mocks.verifyAndPriceItems.mockResolvedValue(verifiedPromotion());
    const response = await POST(new Request('https://libereal.cn/api/orders', {
      method: 'POST', body: JSON.stringify({ items: submittedPromotion(), paymentMethod, acceptedLegalIds: ['checkout-terms'] }),
    }) as never);
    expect(response.status).toBe(200);
    expect(mocks.orderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ subtotal: 900, total: 650,
        adjustments: { create: expect.arrayContaining([expect.objectContaining({ type: 'promotion_addon', amount: -250 })]) },
      }),
    });
  });

  it('accepts a matching checkout revision', async () => {
    const priced = verifiedPromotion();
    mocks.verifyAndPriceItems.mockResolvedValue(priced);
    const checkoutRevision = buildCheckoutRevision({
      items: priced.verifiedItems,
      adjustments: [{ type: 'promotion_addon', amount: -250 }],
      total: 650,
      points: null,
    });
    const response = await POST(request({ items: submittedPromotion(), paymentMethod: 'bank_transfer', checkoutRevision, acceptedLegalIds: ['checkout-terms'] }) as never);
    expect(response.status).toBe(200);
  });

  it('rejects stale or malformed supplied revisions before order creation', async () => {
    mocks.verifyAndPriceItems.mockResolvedValue(verifiedPromotion());
    const base = { items: submittedPromotion(), paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'] };
    expect((await POST(request({ ...base, checkoutRevision: '0'.repeat(64) }) as never)).status).toBe(409);
    expect((await POST(request({ ...base, checkoutRevision: '' }) as never)).status).toBe(400);
    expect((await POST(request({ ...base, checkoutRevision: 'invalid' }) as never)).status).toBe(400);
    expect((await POST(request({ ...base, checkoutRevision: 123 }) as never)).status).toBe(400);
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });

  it.each(['shortfall', 'excess', 'wrongSku', 'wrongBrand', 'wrongPrice', 'unknownRule', 'fallback'])('核验合成活动资格并下单 %s', async (kind) => {
    const lines = promotionLines(kind === 'shortfall' ? 5 : 6, kind === 'excess' ? 2 : 1);
    const submitted = submittedPromotion(lines);
    const verified = verifiedPromotion(lines);
    if (kind === 'wrongSku') verified.verifiedItems[1].catalogNumber = 'OTHER';
    if (kind === 'wrongBrand') verified.verifiedItems[0].brand = 'Other';
    if (kind === 'wrongPrice') submitted[1].promoMark!.price = 0;
    if (kind === 'unknownRule') submitted[1].promoMark!.ruleId = 'unknown';
    if (kind === 'fallback') verified.verifiedItems[0].source = 'fallback';
    mocks.verifyAndPriceItems.mockResolvedValue(verified);
    const response = await POST(new Request('https://libereal.cn/api/orders', {
      method: 'POST', body: JSON.stringify({ items: submitted, paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'] }),
    }) as never);
    if (kind === 'shortfall') {
      expect(response.status).toBe(200);
      expect(mocks.orderCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ subtotal: 800, total: 800 }) });
    } else if (kind === 'excess') {
      expect(response.status).toBe(200);
      expect(mocks.orderCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ subtotal: 1200, total: 950 }) });
    } else {
      expect(response.status).toBe(400);
      expect(mocks.orderCreate).not.toHaveBeenCalled();
    }
  });

  it('拒绝非法数量', async () => {
    mocks.verifyAndPriceItems.mockRejectedValue(new Error('INVALID_QUANTITY'));
    const response = await POST(new Request('https://libereal.cn/api/orders', {
      method: 'POST', body: JSON.stringify({ items: submittedPromotion(), paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'] }),
    }) as never);
    expect(response.status).toBe(400);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.revalidateReferencePriceEvidence.mockResolvedValue(true);
    mocks.auth.mockResolvedValue({ user: { id: 'user-1', email: 'buyer@example.com', role: 'customer', sessionId: 'session-1' } });
    mocks.requireActiveSession.mockResolvedValue({ id: 'user-1', email: 'buyer@example.com', role: 'customer', sessionId: 'session-1' });
    mocks.userFindUnique.mockResolvedValue({
      email: 'buyer@example.com',
      isBlacklisted: false,
      isFrozen: false,
      approvalStatus: 'approved',
      creditAccount: null,
    });
    mocks.getRequiredLegalConsent.mockResolvedValue({
      requiredIds: ['checkout-terms'],
      snapshot: [{ id: 'checkout-terms', version: '2026-07-01' }],
    });
    mocks.validateAcceptedLegalIds.mockReturnValue({ ok: true });
    mocks.verifyAndPriceItems.mockResolvedValue({
      verifiedSubtotal: 100,
      mismatchedCount: 0,
      verifiedItems: [{
        productId: 'product-1',
        catalogNumber: 'CAT-1',
        name: '测试产品',
        unitPrice: 100,
        clientPrice: undefined,
        quantity: 1,
        lineTotal: 100,
        pricingSnapshot: '{"finalPrice":100}',
      }],
    });
    mocks.orderFindFirst.mockResolvedValue(null);
    mocks.orderFindUnique.mockResolvedValue(null);
    mocks.orderCreate.mockResolvedValue({ id: 'ORD-20260723-001' });
    mocks.notificationCreate.mockResolvedValue({});
    mocks.notificationFindMany.mockResolvedValue([]);
    mocks.sendAdminOperationalEmail.mockResolvedValue(undefined);
    mocks.previewPointsRedeem.mockResolvedValue({
      ok: true,
      breakdown: {
        personalPoints: 10,
        groupPoints: 0,
        groupId: null,
        pointsDiscount: 10,
        payableBeforePoints: 100,
        payableAfterPoints: 90,
      },
    });
    mocks.applyOrderPointsDeduction.mockResolvedValue({ ok: true });
  });

  it('uses public fee-free defaults for third-party platform orders', async () => {
    const response = await POST(request({
      paymentMethod: 'rjmart',
      acceptedLegalIds: ['checkout-terms'],
      items: [{ productId: 'product-1', name: '测试产品', price: 100, quantity: 1 }],
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.orderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subtotal: 100,
        adjustmentTotal: 0,
        total: 100,
        status: 'pending',
        paymentMethod: 'rjmart',
      }),
    });
    expect(mocks.notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: '新订单 ORD-20260723-001，金额 ¥100',
      }),
    });
  });

  it('rejects frozen accounts before pricing', async () => {
    mocks.userFindUnique.mockResolvedValue({
      email: 'buyer@example.com',
      isBlacklisted: false,
      isFrozen: true,
      approvalStatus: 'approved',
      creditAccount: null,
    });

    const response = await POST(request({
      paymentMethod: 'alipay',
      acceptedLegalIds: ['checkout-terms'],
      items: [{ productId: 'product-1', name: '测试产品', price: 100, quantity: 1 }],
    }) as never);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('冻结');
    expect(mocks.verifyAndPriceItems).not.toHaveBeenCalled();
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });

  it('reserves points when an Alipay order is created', async () => {
    const response = await POST(request({
      paymentMethod: 'alipay',
      acceptedLegalIds: ['checkout-terms'],
      personalPoints: 10,
      items: [{ productId: 'product-1', name: '测试产品', price: 100, quantity: 1 }],
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.orderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'unpaid',
        paymentMethod: 'alipay',
      }),
    });
    expect(mocks.previewPointsRedeem).toHaveBeenCalledTimes(2);
    expect(mocks.applyOrderPointsDeduction).toHaveBeenCalledWith(expect.anything(), 'ORD-20260723-001');
  });

  it('rejects insufficient variant stock with 400 and does not create the order', async () => {
    mocks.verifyAndPriceItems.mockResolvedValue({
      verifiedSubtotal: 200,
      mismatchedCount: 0,
      verifiedItems: [{
        productId: 'product-1',
        catalogNumber: 'CAT-1-V',
        name: '测试产品',
        unitPrice: 100,
        quantity: 2,
        lineTotal: 200,
        variantId: 'variant-1',
        stockQuantity: 1,
        available: true,
        pricingSnapshot: '{"finalPrice":100}',
        source: 'db',
        priceMismatch: false,
      }],
    });

    const response = await POST(request({
      paymentMethod: 'bank_transfer',
      acceptedLegalIds: ['checkout-terms'],
      items: [{ productId: 'product-1', variantId: 'variant-1', catalogNumber: 'CAT-1-V', name: '测试产品', price: 100, quantity: 2 }],
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: '所选规格库存不足',
      code: 'VARIANT_INSUFFICIENT_STOCK',
      catalogNumber: 'CAT-1-V',
    });
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });

  it('keeps product-level stock rejection on the existing conflict response', async () => {
    mocks.verifyAndPriceItems.mockResolvedValue({
      verifiedSubtotal: 100,
      mismatchedCount: 0,
      verifiedItems: [{
        productId: 'product-1',
        catalogNumber: 'CAT-1',
        name: '测试产品',
        unitPrice: 100,
        quantity: 1,
        lineTotal: 100,
        stockQuantity: 0,
        available: true,
        pricingSnapshot: '{"finalPrice":100}',
        source: 'db',
        priceMismatch: false,
      }],
    });

    const response = await POST(request({
      paymentMethod: 'bank_transfer',
      acceptedLegalIds: ['checkout-terms'],
      items: [{ productId: 'product-1', catalogNumber: 'CAT-1', name: '测试产品', price: 100, quantity: 1 }],
    }) as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: '库存不足，请刷新购物车后重试',
      code: 'INSUFFICIENT_STOCK',
    });
    expect(mocks.orderCreate).not.toHaveBeenCalled();
  });
});
