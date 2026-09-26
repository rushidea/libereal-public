import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  verifyAndPriceItems: vi.fn(),
  userFindUnique: vi.fn(),
  orderFindFirst: vi.fn(),
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
vi.mock('@/lib/pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pricing')>();
  return {
    ...actual,
    verifyAndPriceItems: mocks.verifyAndPriceItems,
  };
});
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    order: {
      findFirst: mocks.orderFindFirst,
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
}));

import { POST } from '@/app/api/orders/route';
import { promotionLines, submittedPromotion, verifiedPromotion } from './cart-promotion-fixtures';
import { buildCheckoutRevision } from '@/lib/checkout-revision';

function request(body: object) {
  return new Request('https://libereal.cn/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/orders', () => {

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
});
