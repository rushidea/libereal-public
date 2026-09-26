import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession, requireAdmin } from '@/lib/session';
import { AMBIGUOUS_PRODUCT_CATALOG_NUMBER, CustomerUnavailableProductError, getVerifiedInventoryError, verifyAndPriceItems } from '@/lib/pricing';
import { reportError } from '@/lib/errorReporting';
import type { Prisma } from '@prisma/client';
import { sendAdminOperationalEmail } from '@/lib/mail';
import {
  getRequiredLegalConsent,
  validateAcceptedLegalIds,
} from '@/lib/legal-documents';
import { orderItemView, toOrderItemCreates } from '@/lib/commerce-records';
import { nextOrderNumber, orderDateInShanghai } from '@/data/order-number';
import { calculateCheckoutFeeAdjustments } from '@/lib/checkout-fees';
import { isThirdPartyPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { getAlipayPaymentSummary } from '@/data/alipay-payment';
import { calculateOrderAmounts, initialOrderStatus } from '@/lib/order-domain';
import { orderAutoCloseAt } from '@/lib/order-auto-close';
import { normalizePointsIntent } from '@/lib/points-checkout';
import { applyOrderPointsDeduction, previewPointsRedeem } from '@/lib/points-checkout-service';
import { assertNoPendingForcedAck } from '@/lib/notification-ack';
import { computePromoAdjustments, validateAddonPromotionLines, validateGiftPromotionLines } from '@/lib/cart-promotions/service';
import type { CartLine } from '@/lib/cart-promotions/types';
import { redeemCoupon } from '@/lib/coupon-service';
import { getReadableOrganizationIds, resolveRecordOwnership } from '@/lib/organization-record-access';
import { listOrganizationIdsForPermission } from '@/lib/organization-service';
import { organizationRbacErrorStatus, OrganizationRbacError, requireOrganizationPermission } from '@/lib/organization-service';

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;
  if (activeUser.role === 'admin') {
    const admin = await requireAdmin('orders.read');
    if (admin instanceof NextResponse) return admin;
  }
  const session = { user: activeUser };

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id as string },
      select: { role: true, email: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const isAdmin = user.role === 'admin';

    const readableOrganizationIds = isAdmin ? [] : await getReadableOrganizationIds(session.user.id as string);
    const orderCreatingOrganizationIds = isAdmin ? [] : await listOrganizationIdsForPermission(session.user.id as string, 'organization.orders.create');
    const where: Prisma.OrderWhereInput = isAdmin
      ? {}
      : {
          OR: [
            { ownerScope: 'personal', email: user.email },
            ...(readableOrganizationIds.length ? [{ ownerScope: 'organization', organizationId: { in: readableOrganizationIds } }] : []),
            ...(orderCreatingOrganizationIds.length ? [{ ownerScope: 'organization', customerId: session.user.id as string, organizationId: { in: orderCreatingOrganizationIds } }] : []),
          ],
        };
    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        orderItems: { orderBy: { position: 'asc' } },
        addressSnapshot: true,
        adjustments: { orderBy: { createdAt: 'asc' } },
        shipments: { orderBy: { createdAt: 'desc' }, include: { items: true } },
        paymentAttempts: { where: { provider: 'alipay' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    // Hydrate with user/inquiry info
    const enriched = await Promise.all(
      orders.map(async (o) => {
        const { paymentAttempts, ...order } = o;
        const canViewPhone = isAdmin
          || o.customerId === session.user.id
          || (o.ownerScope === 'personal' && o.email === session.user.email);
        const userRow = await prisma.user.findUnique({
          where: { email: o.email },
          select: { name: true, institution: true, department: true },
        });
        const phoneRow = canViewPhone
          ? await prisma.user.findUnique({ where: { email: o.email }, select: { phone: true } })
          : null;
        let inquiry: { id: string; name: string; institution: string | null } | null = null;
        if (o.inquiryId) {
          const inq = await prisma.inquiry.findUnique({
            where: { id: o.inquiryId },
            select: { id: true, name: true, institution: true },
          });
          inquiry = inq;
        }
        return {
          ...order,
          items: order.orderItems.map(orderItemView),
          orderItems: undefined,
          userName: userRow?.name || inquiry?.name || '',
          userInstitution: userRow?.institution || inquiry?.institution || '',
          userPhone: phoneRow?.phone || '',
          userDepartment: userRow?.department || '',
          payment: getAlipayPaymentSummary(order, paymentAttempts[0]),
        };
      })
    );

    return NextResponse.json(enriched);
  } catch (err) {
    reportError(err, { tags: { route: 'orders' }, extra: { method: 'GET' } });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;
  const session = { user: activeUser };

  try {
    const { items, paymentMethod, addressId, addressName, addressPhone, addressText, addressInstitution, acceptedLegalIds, personalPoints, groupPoints, groupId, couponCode, organizationId } = await req.json();

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 });
    }
    const normalizedPaymentMethod = normalizeOrderPaymentMethod(paymentMethod);
    if (!normalizedPaymentMethod) {
      return NextResponse.json({ error: '请选择有效的付款方式' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id as string },
      select: { email: true, role: true, isBlacklisted: true, isFrozen: true, approvalStatus: true, creditAccount: { select: { status: true } } },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const forcedAckBlock = await assertNoPendingForcedAck(session.user.id as string, user.role);
    if (forcedAckBlock) return forcedAckBlock;
    if (user.isFrozen) {
      return NextResponse.json({ error: '账户已冻结，暂时无法提交订单或询价。' }, { status: 403 });
    }
    if (user.isBlacklisted || user.approvalStatus === 'rejected' || user.creditAccount?.status === 'paused' || user.creditAccount?.status === 'overdue_hold') {
      return NextResponse.json({ error: '账户当前无法提交采购订单。' }, { status: 403 });
    }

    let ownership: { organizationId: string | null; ownerScope: 'personal' | 'organization' };
    try {
      if (organizationId) {
        await requireOrganizationPermission(session.user.id as string, organizationId, 'organization.pricing.read');
      }
      ownership = await resolveRecordOwnership(session.user.id as string, organizationId, 'organization.orders.create');
    } catch (error) {
      if (error instanceof OrganizationRbacError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: organizationRbacErrorStatus(error) });
      }
      throw error;
    }

    const legalAcceptedAt = new Date();
    const { requiredIds: requiredLegalIds, snapshot: legalAcceptedSnapshot } =
      await getRequiredLegalConsent('checkout', legalAcceptedAt);
    const legalCheck = validateAcceptedLegalIds(acceptedLegalIds, requiredLegalIds);
    if (!legalCheck.ok) {
      return NextResponse.json({ error: '请先阅读并同意全部必同意协议后再下单' }, { status: 400 });
    }

    // Server-side price verification: never trust client-submitted prices
    const { verifiedItems, verifiedSubtotal, mismatchedCount } = await verifyAndPriceItems(items, { userId: session.user.id as string, allowClientFallback: false, strictQuantity: true });
    const unavailableItem = verifiedItems.find((item) => getVerifiedInventoryError(item));
    if (unavailableItem) {
      const inventoryError = getVerifiedInventoryError(unavailableItem);
      return NextResponse.json({
        error: inventoryError === 'INSUFFICIENT_STOCK' ? '库存不足，请刷新购物车后重试' : '商品当前缺货，请刷新购物车后重试',
        code: inventoryError,
        catalogNumber: unavailableItem.catalogNumber,
      }, { status: 409 });
    }
    if (mismatchedCount > 0) {
      console.warn(`[orders POST] ${mismatchedCount} item(s) missing DB price; using client price (admin review needed)`);
    }

    const orderItems = verifiedItems.map((vi, idx) => {
      const raw = items[idx];
      return ({
      productId: vi.productId || null,
      catalogNumber: vi.catalogNumber || null,
      name: vi.name,
      price: vi.unitPrice,
      clientPrice: vi.clientPrice,
      quantity: vi.quantity,
      shippedQty: 0,
      leadTime: vi.leadTime ?? null,
      status: 'pending',
      metadata: JSON.stringify({
        variantId: vi.variantId ?? null,
        spec: vi.spec ?? raw?.spec ?? null,
        unit: vi.unit ?? raw?.unit ?? null,
        stockSnapshot: {
          available: vi.available ?? null,
          stockQuantity: vi.stockQuantity ?? null,
          leadTime: vi.leadTime ?? null,
        },
      }),
      pricingSnapshot: vi.pricingSnapshot,
      });
    });
    // ── 购物车活动（换购/赠品/组合折扣）：服务端重新评估 + 额度校验 + 生成优惠扣减 ──
    const promoLines: CartLine[] = verifiedItems.map((vi, idx) => {
      const raw = items[idx] as { brand?: string | null; promoMark?: { ruleId: string; price?: number } | null } | undefined;
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
    const { evals: promoEvals, adjustments: promoAdjustments, discountTotal: promoDiscountTotal } =
      computePromoAdjustments(promoLines, new Date());
    const addonValidationError = validateAddonPromotionLines(promoLines, promoEvals);
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
    const giftValidationError = validateGiftPromotionLines(promoLines, promoEvals);
    if (giftValidationError) {
      return NextResponse.json({ error: '赠品促销资格无效，请刷新购物车后再试', code: giftValidationError }, { status: 400 });
    }
    // 校验促销标记行：规则须存在且有效、额度须足够、换购价须与规则一致（防前端改价）
    for (const line of promoLines) {
      if (!line.promoMark) continue;
      const ev = promoEvals.find((e) => e.rule.id === line.promoMark!.ruleId);
      if (!ev || !ev.active) {
        return NextResponse.json({ error: '促销活动不存在或已结束，请刷新购物车后再试' }, { status: 400 });
      }
      if (ev.rule.type === 'addon') {
        continue;
      } else if (ev.rule.type === 'gift') {
        const remaining = (ev.details?.remainingGifts as number) ?? 0;
        if (remaining < 0) {
          return NextResponse.json({ error: '赠品数量超出活动额度' }, { status: 400 });
        }
      }
    }

    // ── 优惠券（落地 5）：预评估（门槛/授权校验 + 金额），事务内原子核销防并发重复使用 ──
    const couponCodeNorm = typeof couponCode === 'string' && couponCode.trim() ? couponCode.trim() : '';
    let couponAdjustment: { type: string; label: string; amount: number; reason: string | null } | null = null;
    if (couponCodeNorm) {
      const { buildCouponRule } = await import('@/lib/coupon-service');
      const rule = await buildCouponRule(couponCodeNorm);
      if (!rule) {
        return NextResponse.json({ error: '优惠券不存在或不可用' }, { status: 400 });
      }
      const { promotionEngine } = await import('@/lib/cart-promotions/engine');
      const couponEval = promotionEngine.evaluateAll(promoLines, [rule.config], new Date())[0];
      if (!couponEval?.triggered || !couponEval.adjustments[0]) {
        const reason = couponEval?.details && typeof (couponEval.details as { couponAmount?: number }).couponAmount === 'number'
          ? couponEval.summary.replace(/^.*?：/, '')
          : '优惠券暂不可用';
        return NextResponse.json({ error: reason }, { status: 400 });
      }
      couponAdjustment = {
        type: 'coupon',
        label: rule.config.name,
        amount: -couponEval.adjustments[0].amount,
        reason: `券码 ${couponCodeNorm}${rule.config.stackable ? '（可叠加）' : ''}`,
      };
    }

    const promoDiscountTotalWithCoupon = promoDiscountTotal + (couponAdjustment ? -couponAdjustment.amount : 0);
    const baseAdjustments = calculateCheckoutFeeAdjustments(verifiedSubtotal - promoDiscountTotalWithCoupon, isThirdPartyPaymentMethod(normalizedPaymentMethod));

    const intent = normalizePointsIntent({ personalPoints, groupPoints, groupId });
    // 积分抵扣上限基于「含券优惠后的应付金额」计算（券+积分共用同一金额基准，
    // 防止小计 100 - 券 30 - 积分抵扣 80 → 负数订单）
    const amountsBeforePoints = calculateOrderAmounts(
      verifiedItems.map((item) => ({ unitPrice: item.unitPrice, quantity: item.quantity })),
      [...baseAdjustments, ...promoAdjustments, ...(couponAdjustment ? [couponAdjustment] : [])],
    );

    let pointsBreakdown: {
      personalPoints: number;
      groupPoints: number;
      groupId: string | null;
      pointsDiscount: number;
      payableBeforePoints: number;
      payableAfterPoints: number;
    } | null = null;
    if (intent.personalPoints > 0 || intent.groupPoints > 0) {
      const preview = await previewPointsRedeem(
        prisma,
        session.user.id as string,
        amountsBeforePoints.total,
        intent,
      );
      if (!preview.ok) {
        return NextResponse.json({ error: preview.error }, { status: 400 });
      }
      pointsBreakdown = preview.breakdown;
    }

    const pointsAdjustment = pointsBreakdown && pointsBreakdown.pointsDiscount > 0
      ? [{
          type: 'points_redeem',
          label: '积分抵扣',
          amount: -pointsBreakdown.pointsDiscount,
          reason: [
            pointsBreakdown.personalPoints > 0 ? `个人 ${pointsBreakdown.personalPoints} 分` : null,
            pointsBreakdown.groupPoints > 0 ? `课题组 ${pointsBreakdown.groupPoints} 分` : null,
          ].filter(Boolean).join(' + ') || null,
        }]
      : [];

    const adjustments = [
      ...baseAdjustments,
      ...promoAdjustments,
      ...(couponAdjustment ? [couponAdjustment] : []),
      ...pointsAdjustment,
    ];
    const amounts = calculateOrderAmounts(
      verifiedItems.map((item) => ({ unitPrice: item.unitPrice, quantity: item.quantity })),
      adjustments,
    );

    const orderCreatedAt = new Date();
    const orderDate = orderDateInShanghai(orderCreatedAt);
    let order: Awaited<ReturnType<typeof prisma.order.create>> | null = null;
    let orderId = '';

    for (let attempt = 0; attempt < 3; attempt++) {
      const latestOrder = await prisma.order.findFirst({
        where: { id: { startsWith: `ORD-${orderDate}-` } },
        orderBy: { id: 'desc' },
        select: { id: true },
      });
      orderId = nextOrderNumber(orderCreatedAt, latestOrder?.id ?? null);

      try {
        order = await prisma.$transaction(async (tx) => {
          // 事务内再次校验积分余额。积分在下单时扣减并作为订单占用，
          // 取消订单时按现有退款逻辑退回，避免支付宝到账后才扣减造成支付已成功但积分结算失败。
          if (pointsBreakdown) {
            const recheck = await previewPointsRedeem(
              tx,
              session.user!.id as string,
              amountsBeforePoints.total,
              intent,
            );
            if (!recheck.ok) {
              throw new Error(`POINTS_PRECHECK:${recheck.error}`);
            }
          }

          const created = await tx.order.create({
            data: {
              id: orderId,
              email: user.email,
              customerId: session.user!.id as string,
              organizationId: ownership.organizationId,
              ownerScope: ownership.ownerScope,
              subtotal: amounts.subtotal,
              adjustmentTotal: amounts.adjustmentTotal,
              total: amounts.total,
              status: initialOrderStatus(normalizedPaymentMethod),
              autoCloseAt: orderAutoCloseAt(normalizedPaymentMethod),
              paymentMethod: normalizedPaymentMethod,
              legalAcceptedIds: JSON.stringify(requiredLegalIds),
              legalAcceptedSnapshot: JSON.stringify(legalAcceptedSnapshot),
              pointsPersonal: pointsBreakdown?.personalPoints ?? 0,
              pointsGroup: pointsBreakdown?.groupPoints ?? 0,
              pointsGroupId: pointsBreakdown?.groupId ?? null,
              pointsDiscount: pointsBreakdown?.pointsDiscount ?? 0,
              ...(addressName || addressPhone || addressText ? {
                addressSnapshot: {
                  create: {
                    sourceAddressId: addressId || null,
                    name: addressName || '',
                    phone: addressPhone || '',
                    address: addressText || '',
                    institution: addressInstitution || null,
                  },
                },
              } : {}),
              ...(adjustments.length ? {
                adjustments: {
                  create: adjustments.map((a) => ({
                    type: a.type,
                    label: a.label,
                    amount: a.amount,
                    reason: ('reason' in a && typeof a.reason === 'string') ? a.reason : null,
                  })),
                },
              } : {}),
              orderItems: {
                create: toOrderItemCreates(orderItems),
              },
              statusHistory: {
                create: {
                  toStatus: initialOrderStatus(normalizedPaymentMethod),
                  actorId: session.user!.id as string,
                  actorEmail: user.email,
                  reason: 'order_created',
                },
              },
              events: {
                create: {
                  type: 'order_created',
                  actorId: session.user!.id as string,
                  actorEmail: user.email,
                  message: '客户提交订单',
                },
              },
            },
          });

          if (pointsBreakdown) {
            const applied = await applyOrderPointsDeduction(tx, created.id);
            if (!applied.ok) {
              throw new Error(`POINTS_APPLY:${applied.error}`);
            }
          }

          // 优惠券原子核销（事务内，防并发重复使用；失败则整单回滚）。
          // 绑定订单 id（redeemedOrderId），退款与审计可追溯。
          if (couponCodeNorm) {
            const redeemed = await redeemCoupon(tx, couponCodeNorm, session.user!.id as string, verifiedSubtotal, created.id);
            if (!redeemed.ok) {
              throw new Error(`COUPON_APPLY:${redeemed.error}`);
            }
          }

          return created;
        });
        break;
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('COUPON_')) {
          const msg = error.message.replace(/^COUPON_APPLY:/, '');
          return NextResponse.json({ error: msg }, { status: 400 });
        }
        if (error instanceof Error && error.message.startsWith('POINTS_')) {
          const msg = error.message.replace(/^POINTS_(PRECHECK|APPLY):/, '');
          return NextResponse.json({ error: msg }, { status: 400 });
        }
        if (!isUniqueConstraintError(error) || attempt === 2) throw error;
      }
    }

    if (!order) {
      throw new Error('ORDER_NUMBER_ALLOCATION_FAILED');
    }

    // Create admin notification
    await prisma.notification.create({
      data: {
        email: 'admin',
        role: 'admin',
        type: 'order_created',
        title: '新订单',
        content: `新订单 ${orderId}，金额 ¥${amounts.total.toLocaleString()}`,
        linkUrl: '/admin/orders',
        metadata: JSON.stringify({ orderId }),
      },
    });

    sendAdminOperationalEmail({
      subject: 'LIBEREAL · 新订单',
      message: `新订单 ${orderId}，金额 ¥${amounts.total.toLocaleString()}`,
      path: '/admin/orders',
    });

    return NextResponse.json({ order, orderId });
  } catch (err) {
    if (err instanceof CustomerUnavailableProductError) {
      return NextResponse.json(
        { error: `${err.productName} 已下架，无法提交订单`, catalogNumber: err.catalogNumber },
        { status: 400 },
      );
    }
    if (err instanceof Error) {
      if (err.message === 'PRODUCT_REQUIRES_INQUIRY') {
        return NextResponse.json({ error: '询价商品需要先提交询价，确认报价后才能下单。' }, { status: 400 });
      }
      if (err.message === AMBIGUOUS_PRODUCT_CATALOG_NUMBER) {
        return NextResponse.json({ error: '部分商品需要确认品牌后再下单。' }, { status: 400 });
      }
      if (['CLIENT_FALLBACK_FORBIDDEN', 'INVALID_FALLBACK_PRICE', 'INVALID_QUANTITY', 'PRODUCT_VARIANT_NOT_FOUND', 'PRODUCT_VARIANT_MISMATCH', 'PRODUCT_CATALOG_MISMATCH', 'PRODUCT_BRAND_MISMATCH'].includes(err.message)) {
        return NextResponse.json({ error: '部分商品信息或价格需要重新确认' }, { status: 400 });
      }
    }
    reportError(err, { tags: { route: 'orders' }, extra: { method: 'POST' } });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
