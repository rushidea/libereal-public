import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  verifyAndPriceItems: vi.fn(),
}));
const sampleRules = vi.hoisted(() => ({ sample: { id: 'sample-addon-rule', type: 'addon' as const, name: 'Synthetic add-on offer', enabled: true, description: 'Synthetic fixture only.', eligibleBrand: 'Sample', eligibleTerms: ['SAMPLE-MAIN'], minQuantity: 6, addonPrice: 50, addonBrand: 'Sample', addonTerms: ['SAMPLE-ADDON'] } }));
vi.mock('@/lib/cart-promotions/rules', () => ({ PROMOTION_RULES: [sampleRules.sample], CART_ADDON_RULES: [sampleRules.sample], CART_GIFT_RULES: [], CART_BUNDLE_RULES: [] }));


vi.mock('@/lib/session', () => ({ requireActiveSession: mocks.requireActiveSession }));
vi.mock('@/lib/pricing', () => ({
  AMBIGUOUS_PRODUCT_CATALOG_NUMBER: 'AMBIGUOUS_PRODUCT_CATALOG_NUMBER',
  verifyAndPriceItems: mocks.verifyAndPriceItems,
  getVerifiedInventoryError: (item: { available?: boolean | null; stockQuantity?: number | null; quantity: number }) => {
    if (item.available === false) return 'PRODUCT_OUT_OF_STOCK';
    if (item.stockQuantity != null && item.stockQuantity >= 0 && item.stockQuantity < item.quantity) return 'INSUFFICIENT_STOCK';
    return null;
  },
}));

import { buildCheckoutRevision } from '@/lib/checkout-revision';
import { POST } from '@/app/api/orders/pricing-preview/route';
import { promotionLines, submittedPromotion, verifiedPromotion } from './cart-promotion-fixtures';

describe('POST /api/orders/pricing-preview', () => {

  it('普通合成商品根据服务端确认身份自动计算加购价', async () => {
    const submitted = submittedPromotion().map((item) => ({ ...item, promoMark: undefined, price: 0 }));
    mocks.verifyAndPriceItems.mockResolvedValue(verifiedPromotion());
    const response = await POST(new Request('https://libereal.cn/api/orders/pricing-preview', {
      method: 'POST', body: JSON.stringify({ items: submitted, paymentMethod: 'bank_transfer' }),
    }) as never);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.promotionDiscount).toBe(250);
    expect(data.items[1].finalLineTotal).toBe(50);
    expect(data.items[1].finalUnitPrice).toBe(50);
    expect(data.items[1].promotionDiscount).toBe(250);
    expect(data.items[1].promotionLabels).toHaveLength(1);
    expect(data.items.reduce((sum: number, item: { finalLineTotal: number }) => sum + item.finalLineTotal, 0))
      .toBe(data.subtotal - data.promotionDiscount);
  });

  it.each(['bank_transfer', 'rjmart'])('计算合成加购价并验证平台费用 %s', async (paymentMethod) => {
    mocks.verifyAndPriceItems.mockResolvedValue(verifiedPromotion());
    const response = await POST(new Request('https://libereal.cn/api/orders/pricing-preview', {
      method: 'POST', body: JSON.stringify({ items: submittedPromotion(), paymentMethod, acceptedLegalIds: ['checkout-terms'] }),
    }) as never);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.total).toBe(650);
    expect(data.checkoutRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(data.promotionDiscount).toBe(250);
    expect(data.items[1]).toMatchObject({ unitPrice: 300, lineTotal: 300, finalLineTotal: 50 });
  });

  it.each(['shortfall', 'excess', 'wrongSku', 'wrongBrand', 'wrongPrice', 'unknownRule', 'fallback'])('核验合成活动资格并计价 %s', async (kind) => {
    const lines = promotionLines(kind === 'shortfall' ? 5 : 6, kind === 'excess' ? 2 : 1);
    const submitted = submittedPromotion(lines);
    const verified = verifiedPromotion(lines);
    if (kind === 'wrongSku') verified.verifiedItems[1].catalogNumber = 'OTHER';
    if (kind === 'wrongBrand') verified.verifiedItems[0].brand = 'Other';
    if (kind === 'wrongPrice') submitted[1].promoMark!.price = 0;
    if (kind === 'unknownRule') submitted[1].promoMark!.ruleId = 'unknown';
    if (kind === 'fallback') verified.verifiedItems[0].source = 'fallback';
    mocks.verifyAndPriceItems.mockResolvedValue(verified);
    const response = await POST(new Request('https://libereal.cn/api/orders/pricing-preview', {
      method: 'POST', body: JSON.stringify({ items: submitted, paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'] }),
    }) as never);
    if (kind === 'shortfall') {
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.total).toBe(800);
      expect(data.promotionDiscount).toBe(0);
    } else if (kind === 'excess') {
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.subtotal).toBe(1200);
      expect(data.total).toBe(950);
      expect(data.promotionDiscount).toBe(250);
      expect(data.items[1].finalLineTotal).toBe(350);
    } else {
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBeTruthy();
    }
  });

  it('拒绝非法数量', async () => {
    mocks.verifyAndPriceItems.mockRejectedValue(new Error('INVALID_ITEM_QUANTITY'));
    const response = await POST(new Request('https://libereal.cn/api/orders/pricing-preview', {
      method: 'POST', body: JSON.stringify({ items: submittedPromotion(), paymentMethod: 'bank_transfer', acceptedLegalIds: ['checkout-terms'] }),
    }) as never);
    expect(response.status).toBe(400);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveSession.mockResolvedValue({ id: 'user-1', email: 'buyer@example.com' });
    mocks.verifyAndPriceItems.mockResolvedValue({
      verifiedSubtotal: 99,
      mismatchedCount: 0,
      verifiedItems: [{
        productId: 'product-1', catalogNumber: 'CAT-1', unitPrice: 99, quantity: 1,
        lineTotal: 99, pricingSnapshot: '{"finalPrice":99}',
      }],
    });
  });

  it('requires an authenticated user', async () => {
    mocks.requireActiveSession.mockResolvedValue(NextResponse.json({ error: '未登录' }, { status: 401 }));
    const response = await POST(new Request('http://localhost/api/orders/pricing-preview', {
      method: 'POST', body: JSON.stringify({ items: [{ productId: 'product-1' }] }),
    }) as never);

    expect(response.status).toBe(401);
    expect(mocks.verifyAndPriceItems).not.toHaveBeenCalled();
  });

  it('rejects an empty item list', async () => {
    const response = await POST(new Request('http://localhost/api/orders/pricing-preview', {
      method: 'POST', body: JSON.stringify({ items: [] }),
    }) as never);

    expect(response.status).toBe(400);
    expect(mocks.verifyAndPriceItems).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    const response = await POST(new Request('http://localhost/api/orders/pricing-preview', {
      method: 'POST', body: '{',
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: '请求内容格式无效' });
    expect(mocks.verifyAndPriceItems).not.toHaveBeenCalled();
  });

  it('returns server-calculated prices and evidence', async () => {
    const items = [{ productId: 'product-1', name: '测试产品', price: 100, quantity: 1 }];
    const response = await POST(new Request('http://localhost/api/orders/pricing-preview', {
      method: 'POST', body: JSON.stringify({ items }),
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      checkoutRevision: buildCheckoutRevision({ items: [{ productId: 'product-1', catalogNumber: 'CAT-1', unitPrice: 99, quantity: 1 }], adjustments: [], total: 99, points: null }),
      subtotal: 99,
      totalBeforePoints: 99,
      adjustmentTotal: 0,
      adjustments: [],
      promotionDiscount: 0,
      promotionAdjustments: [],
      points: null,
      total: 99,
      coupon: null,
      couponError: null,
      items: [{
        productId: 'product-1', catalogNumber: 'CAT-1', unitPrice: 99,
        finalUnitPrice: 99, quantity: 1, lineTotal: 99, finalLineTotal: 99,
        promotionDiscount: 0, promotionLabels: [], pricingSnapshot: '{"finalPrice":99}',
      }],
    });
    expect(mocks.verifyAndPriceItems).toHaveBeenCalledWith(items, {
      userId: 'user-1', allowClientFallback: false, strictQuantity: true,
    });
  });

  it('reports products that require inquiry', async () => {
    mocks.verifyAndPriceItems.mockRejectedValue(new Error('PRODUCT_REQUIRES_INQUIRY'));
    const response = await POST(new Request('http://localhost/api/orders/pricing-preview', {
      method: 'POST', body: JSON.stringify({ items: [{ productId: 'product-1' }] }),
    }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: '部分商品价格需要重新确认' });
  });

  it('rejects client fallback pricing', async () => {
    mocks.verifyAndPriceItems.mockRejectedValue(new Error('CLIENT_FALLBACK_FORBIDDEN'));
    const response = await POST(new Request('http://localhost/api/orders/pricing-preview', {
      method: 'POST', body: JSON.stringify({ items: [{ productId: 'unknown', name: '测试', price: 1, quantity: 1 }] }),
    }) as never);
    expect(response.status).toBe(400);
  });

  it('rejects invalid quantities', async () => {
    mocks.verifyAndPriceItems.mockRejectedValue(new Error('INVALID_QUANTITY'));
    const response = await POST(new Request('http://localhost/api/orders/pricing-preview', {
      method: 'POST', body: JSON.stringify({ items: [{ productId: 'product-1', quantity: 1.5 }] }),
    }) as never);
    expect(response.status).toBe(400);
  });
});
