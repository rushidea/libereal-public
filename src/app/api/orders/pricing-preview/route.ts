import { NextRequest, NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { AMBIGUOUS_PRODUCT_CATALOG_NUMBER, getVerifiedInventoryError, verifyAndPriceItems } from '@/lib/pricing';
import { calculateCheckoutFeeAdjustments } from '@/lib/checkout-fees';
import { isThirdPartyPaymentMethod } from '@/data/payment-methods';
import { calculateOrderAmounts } from '@/lib/order-domain';
import { previewPointsRedeem } from '@/lib/points-checkout-service';
import { normalizePointsIntent } from '@/lib/points-checkout';
import { computePromoAdjustments, validateAddonPromotionLines, validateGiftPromotionLines } from '@/lib/cart-promotions/service';
import type { CartLine } from '@/lib/cart-promotions/types';
import { buildCouponRule } from '@/lib/coupon-service';
import { requireOrganizationPermission } from '@/lib/organization-service';

export async function POST(req: NextRequest) {
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;
  const session = { user: activeUser };

  let body: {
    items?: unknown;
    paymentMethod?: string;
    personalPoints?: unknown;
    groupPoints?: unknown;
    groupId?: unknown;
    organizationId?: unknown;
    couponCode?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 });
  }

  try {
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 });
    }
    if (body.organizationId !== undefined && body.organizationId !== null && body.organizationId !== '') {
      if (typeof body.organizationId !== 'string') return NextResponse.json({ error: '组织信息无效' }, { status: 400 });
      try {
        await requireOrganizationPermission(session.user.id as string, body.organizationId, 'organization.pricing.read');
      } catch {
        return NextResponse.json({ error: '组织价格查看权限不足' }, { status: 403 });
      }
    }

    const priced = await verifyAndPriceItems(body.items, { userId: session.user.id as string, allowClientFallback: false, strictQuantity: true });
    const unavailableItem = priced.verifiedItems.find((item) => getVerifiedInventoryError(item));
    if (unavailableItem) {
      const inventoryError = getVerifiedInventoryError(unavailableItem);
      return NextResponse.json({
        error: inventoryError === 'INSUFFICIENT_STOCK' ? '库存不足，请刷新购物车后重试' : '商品当前缺货，请刷新购物车后重试',
        code: inventoryError,
        catalogNumber: unavailableItem.catalogNumber,
      }, { status: 409 });
    }

    // 购物车活动评估（与 /api/orders 同源），优惠金额并入调整、平台费按优惠后成交价计算
    const promoLines: CartLine[] = priced.verifiedItems.map((vi, idx) => {
      const raw = (body.items as Array<{ brand?: string | null; promoMark?: { ruleId: string; price?: number } | null }>)[idx];
      return {
        product: {
          id: vi.productId ?? '',
          brand: vi.brand ?? raw?.brand ?? '',
          catalogNumber: vi.catalogNumber ?? '',
          price: vi.unitPrice,
          spec: vi.spec ?? null,
          serverVerified: vi.source === 'db',
        },
        quantity: vi.quantity,
        isQuickOrder: false,
        promoMark: raw?.promoMark ?? null,
      };
    });

    const promoComputation = computePromoAdjustments(promoLines, new Date());
    const addonValidationError = validateAddonPromotionLines(promoLines, promoComputation.evals);
    if (addonValidationError) {
      const messages: Record<typeof addonValidationError, string> = {
        PROMOTION_NOT_FOUND: '促销活动不存在或已结束，请刷新购物车后再试',
        ADDON_NOT_TRIGGERED: '主品数量未达到换购门槛，请核对购物车',
        ADDON_QUOTA_EXCEEDED: '换购额度不足，请核对主品数量',
        ADDON_PRODUCT_INVALID: '换购商品不符合活动范围，请刷新购物车后再试',
        ADDON_PRICE_INVALID: '换购价格校验失败，请刷新后重试',
      };
      return NextResponse.json({ error: messages[addonValidationError] }, { status: 400 });
    }
    const giftValidationError = validateGiftPromotionLines(promoLines, promoComputation.evals);
    if (giftValidationError) {
      return NextResponse.json({ error: '赠品促销资格无效，请刷新购物车后再试', code: giftValidationError }, { status: 400 });
    }
    const { adjustments: promoAdjustments, discountTotal: promoDiscountTotal } = promoComputation;

    // ── 优惠券（落地 5）：满减/无门槛券，服务端重新评估（防前端改价）──
    let couponAdjustment: { type: string; label: string; amount: number; reason: string | null } | null = null;
    let couponError: string | null = null;
    const couponCode = typeof body.couponCode === 'string' && body.couponCode.trim() ? body.couponCode.trim() : '';
    if (couponCode) {
      const rule = await buildCouponRule(couponCode);
      if (!rule) {
        couponError = '优惠券不存在或不可用';
      } else {
        // 券门槛基于商品小计（不含券本身优惠）
        const couponEval = promoComputation.evals.find(
          (e) => e.rule.id === `coupon:${couponCode}`,
        );
        // 若引擎未评估（如未注入规则），手动评估：校验授权/门槛后计算
        const evalResult = couponEval
          ?? (await import('@/lib/cart-promotions/engine')).promotionEngine.evaluateAll(
            promoLines,
            [rule.config],
            new Date(),
          )[0];
        if (evalResult?.triggered && evalResult.adjustments[0]) {
          couponAdjustment = {
            type: 'coupon',
            label: rule.config.name,
            amount: -evalResult.adjustments[0].amount,
            reason: `券码 ${couponCode}${rule.config.stackable ? '（可叠加）' : ''}`,
          };
        } else if (evalResult?.details && typeof evalResult.details.couponAmount === 'number' && evalResult.details.couponAmount === 0) {
          // 门槛不足/待授权等：透出具体原因
          couponError = evalResult.summary.replace(/^.*?：/, '');
        } else {
          couponError = '优惠券暂不可用';
        }
      }
    }

    const promoDiscountTotalWithCoupon = promoDiscountTotal + (couponAdjustment ? -couponAdjustment.amount : 0);
    const adjustments = calculateCheckoutFeeAdjustments(priced.verifiedSubtotal - promoDiscountTotalWithCoupon, isThirdPartyPaymentMethod(body.paymentMethod || ''));
    const allAdjustments = [
      ...adjustments,
      ...promoAdjustments,
      ...(couponAdjustment ? [couponAdjustment] : []),
    ];
    const amounts = calculateOrderAmounts(
      priced.verifiedItems.map((item) => ({ unitPrice: item.unitPrice, quantity: item.quantity })),
      allAdjustments,
    );

    const intent = normalizePointsIntent({
      personalPoints: body.personalPoints,
      groupPoints: body.groupPoints,
      groupId: body.groupId,
    });

    let pointsBreakdown = null;
    if (intent.personalPoints > 0 || intent.groupPoints > 0) {
      const preview = await previewPointsRedeem(prisma, session.user.id as string, amounts.total, intent);
      if (!preview.ok) {
        return NextResponse.json({ error: preview.error }, { status: 400 });
      }
      pointsBreakdown = preview.breakdown;
    }

    const payable = pointsBreakdown?.payableAfterPoints ?? amounts.total;

    return NextResponse.json({
      subtotal: amounts.subtotal,
      promotionDiscount: promoDiscountTotal,
      promotionAdjustments: promoAdjustments,
      adjustmentTotal: amounts.adjustmentTotal,
      // Keep cart-promotion adjustments in the preview so checkout can explain
      // the authoritative total without recomputing discounts in the browser.
      adjustments: [...adjustments, ...promoAdjustments],
      coupon: couponAdjustment,
      couponError,
      totalBeforePoints: amounts.total,
      points: pointsBreakdown,
      total: payable,
      items: priced.verifiedItems.map((item, index) => ({
        productId: item.productId,
        catalogNumber: item.catalogNumber,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
        finalUnitPrice: item.unitPrice - ((promoComputation.lineDiscounts[String(index)] ?? 0) / Math.max(1, item.quantity)),
        finalLineTotal: item.lineTotal - (promoComputation.lineDiscounts[String(index)] ?? 0),
        promotionDiscount: promoComputation.lineDiscounts[String(index)] ?? 0,
        promotionLabels: promoComputation.linePromotionLabels[String(index)] ?? [],
        available: item.available,
        leadTime: item.leadTime,
        stockQuantity: item.stockQuantity,
        pricingSnapshot: item.pricingSnapshot,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'PRODUCT_REQUIRES_INQUIRY' || message === 'INVALID_FALLBACK_PRICE' || message === 'CLIENT_FALLBACK_FORBIDDEN' || message === 'INVALID_QUANTITY' || message === 'INVALID_ITEM_QUANTITY' || message === 'PRODUCT_VARIANT_NOT_FOUND' || message === 'PRODUCT_VARIANT_MISMATCH' || message === 'PRODUCT_CATALOG_MISMATCH' || message === 'PRODUCT_BRAND_MISMATCH' || message === AMBIGUOUS_PRODUCT_CATALOG_NUMBER) {
      return NextResponse.json({ error: '部分商品价格需要重新确认' }, { status: 400 });
    }
    console.error('[orders/pricing-preview POST] error:', error);
    return NextResponse.json({ error: '价格计算失败' }, { status: 500 });
  }
}
