import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession, requireAdmin } from '@/lib/session';
import { AMBIGUOUS_PRODUCT_CATALOG_NUMBER, CustomerUnavailableProductError, getVerifiedInventoryError, revalidateReferencePriceEvidence, verifyAndPriceItems, type PriceLookupItem, type VerifiedItem } from '@/lib/pricing';
import { reportError } from '@/lib/errorReporting';
import type { Prisma } from '@prisma/client';
import { sendAdminOperationalEmail } from '@/lib/mail';
import {
  getRequiredLegalConsent,
  validateAcceptedLegalIds,
} from '@/lib/legal-documents';
import { orderItemView, toOrderItemCreates } from '@/lib/commerce-records';
import { isOrderIdUniqueConflict, ORDER_NUMBER_BUSY_ERROR, withAllocatedOrderNumber } from '@/data/order-number';
import { calculateCheckoutFeeAdjustments } from '@/lib/checkout-fees';
import { isThirdPartyPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { getAlipayPaymentSummary } from '@/data/alipay-payment';
import { calculateOrderAmounts, initialOrderStatus } from '@/lib/order-domain';
import { orderAutoCloseAt } from '@/lib/order-auto-close';
import { normalizePointsIntent } from '@/lib/points-checkout';
import { applyOrderPointsDeduction, previewPointsRedeem } from '@/lib/points-checkout-service';
import { assertNoPendingForcedAck } from '@/lib/notification-ack';
import { computePromoAdjustments, hasExceededSelectionAddonQuota, hasMisbrandedEligibleAddonMain, validateAddonPromotionLines, validateGiftPromotionLines } from '@/lib/cart-promotions/service';
import type { CartLine } from '@/lib/cart-promotions/types';
import { buildCheckoutRevision, stablePricingEvidence } from '@/lib/checkout-revision';
import { normalizedEmailEquals, verifiedStoredEmail } from '@/lib/verified-email-access';
import { redeemCoupon, type CouponRedeemSnapshot } from '@/lib/coupon-service';
import { couponLineIsInScope, couponPromotionEvidenceForScope, formatCouponScopeLabel } from '@/lib/coupon-scope';
import { getReadableOrganizationIds, resolveRecordOwnership } from '@/lib/organization-record-access';
import { listOrganizationIdsForPermission } from '@/lib/organization-service';
import { organizationRbacErrorStatus, OrganizationRbacError, requireOrganizationPermission } from '@/lib/organization-service';
import { buildCheckoutRequestFingerprint, isUniqueConstraintError, validCheckoutAttemptId } from '@/lib/checkout-idempotency';

import {
  assertVariantCheckoutStock,
  isVariantStockInsufficientError,
  reserveOrderInventory,
  VARIANT_STOCK_INSUFFICIENT,
  VARIANT_STOCK_INSUFFICIENT_MESSAGE,
} from '@/lib/inventory';
import { ownerPrepaySettlementViews } from '@/lib/order-prepay-settlement';
import { createUnifiedPricingSnapshot, resolveUnifiedPricingIdentities, type UnifiedPricingClient, type UnifiedPricingIdentity, type UnifiedPricingSnapshot } from '@/lib/unified-pricing-snapshot';
import { allocateUnifiedBandsToSources } from '@/lib/unified-price-band-sources';
import { unifiedPromotionRuntimeEnabled } from '@/lib/unified-promotion-config';

type UnifiedOrderDependencies = {
  ready: boolean;
  client: UnifiedPricingClient;
  createSnapshot: typeof createUnifiedPricingSnapshot;
  resolveIdentities: typeof resolveUnifiedPricingIdentities;
};

function unifiedCampaignOverlapsLegacyDiscounts(items: VerifiedItem[], discounts: Record<string, number>): boolean {
  return items.some((item, index) => Boolean((item as VerifiedItem & { unifiedOccupiedPromotionId?: string | null }).unifiedOccupiedPromotionId
    ?? item.selectedPromotionId) && (discounts[String(index)] ?? 0) > 0);
}

function unifiedPromotionIdentity(snapshot: UnifiedPricingSnapshot, productId: string, variantId: string | null, promotionId: string | null) {
  if (promotionId && snapshot.evidence.promotions.some((promotion) => promotion.id === promotionId)) return { state: 'restricted' as const, promotionId };
  // Static cart rules have a distinct namespace and a verifiable version;
  // never represent their identifiers as database Promotion IDs.
  if (promotionId?.startsWith('legacy-cart:')) {
    const rule = snapshot.evidence.legacyCartPromotions.find((entry) => entry.id === promotionId);
    if (!rule) throw new Error('UNIFIED_PRICING_PROMOTION_INCOMPLETE');
    return { state: 'static' as const, ruleId: rule.id, versionHash: rule.versionHash };
  }
  const product = snapshot.evidence.products.find((entry) => entry.id === productId);
  const variant = product?.variants.find((entry) => entry && typeof entry === 'object' && 'id' in entry && entry.id === variantId) as { promotionalPrice?: number | null } | undefined;
  const synthetic = (product?.promotionalPrice ?? 0) > 0 || (variant?.promotionalPrice ?? 0) > 0;
  const active = snapshot.evidence.promotions.some((promotion) => promotion.status === 'active'
    && Date.parse(promotion.startsAt) <= Date.parse(snapshot.evidence.at) && Date.parse(promotion.endsAt) > Date.parse(snapshot.evidence.at)
    && promotion.bindings.some((binding) => binding.productId === productId && (binding.variantId === variantId || binding.variantId === null)));
  return !synthetic && !active ? { state: 'knownnone' as const } : { state: 'unknown' as const };
}

function unifiedCouponEvidence(snapshot: UnifiedPricingSnapshot, productId: string, variantId: string | null, identity: ReturnType<typeof unifiedPromotionIdentity>): import('@/lib/pricing').CouponPromotionPricingEvidence {
  const product = snapshot.evidence.products.find((entry) => entry.id === productId);
  if (!product || typeof product.price !== 'number' || !Number.isFinite(product.price)) throw new Error('UNIFIED_COUPON_EVIDENCE_UNSUPPORTED');
  const variant = product.variants.find((entry) => entry && typeof entry === 'object' && 'id' in entry && entry.id === variantId) as { id: string; price: number | null; promotionalPrice: number | null; minimumSalePrice: number | null } | undefined;
  const links = product.promotionLinks as Array<{ id: string; productId: string; variantId: string | null; groupKey: string; promotionId: string }>;
  return { productId, variantId, pricedAt: snapshot.evidence.at, identity,
    product: { price: product.price, originalPrice: product.originalPrice, promotionalPrice: product.promotionalPrice, minimumSalePrice: product.minimumSalePrice },
    variant: variant ? { price: variant.price, promotionalPrice: variant.promotionalPrice, minimumSalePrice: variant.minimumSalePrice } : null,
    candidates: links.filter((link) => link.variantId === null || link.variantId === variantId).map((link) => {
      const promotion = snapshot.evidence.promotions.find((entry) => entry.id === link.promotionId);
      if (!promotion) throw new Error('UNIFIED_PRICING_PROMOTION_INCOMPLETE');
      return { bindingId: link.id, productId: link.productId, variantId: link.variantId, groupKey: link.groupKey,
        promotion: { id: promotion.id, type: promotion.type, value: promotion.value, ruleDefinition: promotion.ruleDefinition,
          ruleVersion: promotion.ruleVersion, status: promotion.status, startsAt: promotion.startsAt, endsAt: promotion.endsAt,
          priority: promotion.priority, exclusive: promotion.exclusive } };
    }).sort((a, b) => a.bindingId.localeCompare(b.bindingId)),
    ...(snapshot.evidence.referencePricePromotionId ? { referencePricePromotionId: snapshot.evidence.referencePricePromotionId,
      referencePriceEligible: variantId === null,
      referencePriceApplied: identity.state === 'restricted' && identity.promotionId === snapshot.evidence.referencePricePromotionId } : {}),
  };
}

async function unifiedOrderItems(
  client: UnifiedPricingClient,
  createSnapshot: typeof createUnifiedPricingSnapshot,
  resolveIdentities: typeof resolveUnifiedPricingIdentities,
  rawItems: PriceLookupItem[],
  userId: string,
): Promise<{ verifiedItems: Array<import('@/lib/pricing').VerifiedItem & { sourceIndex: number }>; verifiedSubtotal: number; mismatchedCount: number; evidenceHash: string }> {
  const build = async (tx: import('@prisma/client').Prisma.TransactionClient) => {
    const identities: UnifiedPricingIdentity[] = [];
    for (const item of rawItems) identities.push((await resolveIdentities(tx, { lines: [{ productId: item.productId, catalogNumber: item.catalogNumber,
      variantId: item.variantId, brand: item.brand, quantity: item.quantity! }] })).items[0]);
    const grouped = new Map<string, { productId: string; variantId: string | null; quantity: number; sourceIndexes: number[] }>();
    identities.forEach((identity, index) => {
      const group = grouped.get(identity.id) ?? { productId: identity.productId, variantId: identity.variantId, quantity: 0, sourceIndexes: [] };
      group.quantity += identity.quantity;
      if (!Number.isSafeInteger(group.quantity)) throw new Error('INVALID_QUANTITY');
      group.sourceIndexes.push(index); grouped.set(identity.id, group);
    });
    for (const group of grouped.values()) {
      const identity = identities[group.sourceIndexes[0]];
      if (!identity.available) throw new Error('UNIFIED_PRODUCT_OUT_OF_STOCK');
      if (identity.stockQuantity != null && identity.stockQuantity >= 0 && identity.stockQuantity < group.quantity) throw new Error('UNIFIED_INSUFFICIENT_STOCK');
    }
    const groups = [...grouped.entries()];
    const now = new Date();
    const snapshot = await createSnapshot(tx, { lines: identities.map((identity, sourceIndex) => ({ productId: identity.productId,
      variantId: identity.variantId, quantity: identity.quantity, promoMark: rawItems[sourceIndex]?.promoMark ?? null })), userId, now });
    const bySku = new Map(snapshot.pricing.lines.map((line) => [JSON.stringify([line.productId, line.variantId]), line]));
    const rows: Array<import('@/lib/pricing').VerifiedItem & { sourceIndex: number }> = [];
    let verifiedSubtotalCents = BigInt(0);
    for (const [skuKey, group] of groups) {
      const result = bySku.get(skuKey);
      const sourceIdentity = identities[group.sourceIndexes[0]];
      if (!result || result.quantity !== group.quantity || !Number.isSafeInteger(result.totalAfterCents) || result.totalAfterCents < 0) throw new Error('INVALID_PROMOTION_PLAN');
      const ordinaryCents = snapshot.evidence.ordinaryUnitPricesCents[group.sourceIndexes[0]] ?? null;
      const nativePriceBands = (result as typeof result & { priceBands?: Array<{ unitCents: number; quantity: number; source: 'ordinary' | 'promotion'; sourceLineId?: string }> }).priceBands;
      const bands = nativePriceBands ?? (result.promotionId === null && ordinaryCents !== null
        && group.sourceIndexes.every((index) => snapshot.evidence.ordinaryUnitPricesCents[index] === ordinaryCents)
        && ordinaryCents * group.quantity === result.totalAfterCents
        ? [{ quantity: group.quantity, unitCents: ordinaryCents, source: 'ordinary' as const }] : null);
      if (!bands || bands.some((band) => !Number.isSafeInteger(band.quantity) || band.quantity <= 0 || !Number.isSafeInteger(band.unitCents) || band.unitCents < 0
        || !['ordinary', 'promotion'].includes(band.source))) throw new Error('UNIFIED_PRICE_BANDS_UNSUPPORTED');
      const bandsQuantity = bands.reduce((sum, band) => sum + BigInt(band.quantity), BigInt(0));
      const bandsTotalCents = bands.reduce((sum, band) => sum + BigInt(band.quantity) * BigInt(band.unitCents), BigInt(0));
      if (bandsQuantity !== BigInt(group.quantity)
        || bandsTotalCents !== BigInt(result.totalAfterCents) || bandsTotalCents > BigInt(Number.MAX_SAFE_INTEGER)
        || bands.some((band) => band.source === 'promotion' && !result.promotionId)) throw new Error('UNIFIED_PRICE_BANDS_UNSUPPORTED');
      verifiedSubtotalCents += bandsTotalCents;
      if (verifiedSubtotalCents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_PROMOTION_AMOUNT');
      const product = snapshot.evidence.products.find((entry) => entry.id === group.productId);
      if (!product) throw new Error('UNIFIED_PRICING_PRODUCT_NOT_FOUND');
      const allocations = allocateUnifiedBandsToSources(bands, group.sourceIndexes.map((sourceIndex) => {
        const mark = rawItems[sourceIndex]?.promoMark;
        return { sourceIndex, quantity: identities[sourceIndex].quantity,
          semantics: JSON.stringify([identities[sourceIndex].id, snapshot.evidence.ordinaryUnitPricesCents[sourceIndex] ?? null,
            mark?.ruleId ?? null, mark?.price ?? null, rawItems[sourceIndex]?.unit ?? null]) };
      }));
      for (const { sourceIndex, band, quantity } of allocations) {
          const promotionId = band.source === 'promotion' ? result.promotionId : null;
          const identityPromotionId = result.occupiedPromotionId?.startsWith('legacy-cart:') ? result.occupiedPromotionId : promotionId;
          const promotionIdentity = unifiedPromotionIdentity(snapshot, group.productId, group.variantId, identityPromotionId);
          const promotionPricingEvidence = unifiedCouponEvidence(snapshot, group.productId, group.variantId, promotionIdentity);
          const unitPrice = band.unitCents / 100;
          const rowTotalCents = BigInt(band.unitCents) * BigInt(quantity);
          if (rowTotalCents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_PROMOTION_AMOUNT');
          rows.push({ productId: sourceIdentity.productId, catalogNumber: sourceIdentity.catalogNumber, brand: sourceIdentity.brand,
            name: sourceIdentity.name, unitPrice,
            baseUnitPrice: snapshot.evidence.ordinaryUnitPricesCents[sourceIndex] == null ? undefined : snapshot.evidence.ordinaryUnitPricesCents[sourceIndex]! / 100,
            quantity, lineTotal: Number(rowTotalCents) / 100, priceMismatch: false, source: 'db',
            variantId: sourceIdentity.variantId, spec: sourceIdentity.spec, unit: rawItems[sourceIndex]?.unit ?? null,
            category: sourceIdentity.category, subcategory: sourceIdentity.subcategory, selectedPromotionId: promotionId,
            unifiedOccupiedPromotionId: result.occupiedPromotionId,
            promotionIdentity, promotionPricingEvidence, pricingAt: snapshot.evidence.at,
            referencePriceEligible: Boolean(snapshot.evidence.referencePricePromotionId && group.variantId === null),
            referencePriceApplied: Boolean(snapshot.evidence.referencePricePromotionId && promotionIdentity.state === 'restricted' && promotionIdentity.promotionId === snapshot.evidence.referencePricePromotionId),
            delisted: sourceIdentity.deletedAt !== null, available: sourceIdentity.available, leadTime: sourceIdentity.leadTime,
            stockQuantity: sourceIdentity.stockQuantity, sourceIndex,
            pricingSnapshot: JSON.stringify({ calculatedAt: snapshot.evidence.at, finalPrice: unitPrice,
              appliedSource: promotionId ? `promotion:${promotionId}` : 'unified_ordinary_price', unifiedPricingEvidenceHash: snapshot.evidenceHash,
              unifiedLineTotalCents: result.totalAfterCents, couponPromotionIdentity: promotionIdentity, couponPromotionPricingEvidence: promotionPricingEvidence,
              referencePricePromotionId: snapshot.evidence.referencePricePromotionId,
              referencePriceApplied: promotionPricingEvidence.referencePriceApplied,
              referencePriceEligible: promotionPricingEvidence.referencePriceEligible }),
          });
      }
    }
    rows.sort((a, b) => a.sourceIndex - b.sourceIndex || b.unitPrice - a.unitPrice);
    return { verifiedItems: rows, verifiedSubtotal: Number(verifiedSubtotalCents) / 100, mismatchedCount: 0, evidenceHash: snapshot.evidenceHash };
  };
  if ('$transaction' in client) return (client as typeof prisma).$transaction((tx) => build(tx));
  return build(client as import('@prisma/client').Prisma.TransactionClient);
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
      select: { role: true, email: true, emailVerified: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const isAdmin = user.role === 'admin';
    const personalEmail = verifiedStoredEmail(user);

    const readableOrganizationIds = isAdmin ? [] : await getReadableOrganizationIds(session.user.id as string);
    const orderCreatingOrganizationIds = isAdmin ? [] : await listOrganizationIdsForPermission(session.user.id as string, 'organization.orders.create');
    const where: Prisma.OrderWhereInput = isAdmin
      ? {}
      : {
          OR: [
            { ownerScope: 'personal', customerId: session.user.id as string },
            ...(personalEmail ? [{ ownerScope: 'personal' as const, email: personalEmail }] : []),
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

    const settlementViews = await ownerPrepaySettlementViews(prisma, orders);
    const enriched = await Promise.all(
      orders.map(async (o) => {
        const { paymentAttempts, ...order } = o;
        const canViewPhone = isAdmin
          || o.customerId === session.user.id
          || (o.ownerScope === 'personal' && personalEmail !== null && normalizedEmailEquals(o.email, personalEmail));
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
          ownerPrepaySettlement: settlementViews.get(o.id) ?? null,
        };
      })
    );

    return NextResponse.json(enriched);
  } catch (err) {
    reportError(err, { tags: { route: 'orders' }, extra: { method: 'GET' } });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** 创建购物车订单。权限：已登录会话；组织结算仍要 organization.pricing.read，组织下单仍要 organization.orders.create。规格库存不足返回 400，不新增权限。 */
async function post(req: NextRequest, dependencies: UnifiedOrderDependencies) {
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;
  const session = { user: activeUser };

  try {
    const body = await req.json() as Record<string, unknown>;
    const typedBody = body as {
      items?: PriceLookupItem[];
      paymentMethod?: string;
      addressId?: string;
      addressName?: string;
      addressPhone?: string;
      addressText?: string;
      addressInstitution?: string;
      acceptedLegalIds?: unknown;
      personalPoints?: unknown;
      groupPoints?: unknown;
      groupId?: unknown;
      couponCode?: unknown;
      organizationId?: string | null;
      checkoutRevision?: unknown;
      checkoutAttemptId?: unknown;
    };
    const { items, paymentMethod, addressId, addressName, addressPhone, addressText, addressInstitution,
      acceptedLegalIds, personalPoints, groupPoints, groupId, couponCode, organizationId } = typedBody;
    if (Object.hasOwn(body, 'checkoutRevision') && (typeof typedBody.checkoutRevision !== 'string' || !/^[a-f0-9]{64}$/.test(typedBody.checkoutRevision))) {
      return NextResponse.json({ error: '结算版本格式无效', code: 'CHECKOUT_REVISION_INVALID' }, { status: 400 });
    }
    const checkoutRevision = typeof typedBody.checkoutRevision === 'string' ? typedBody.checkoutRevision : undefined;
    const headerAttemptId = req.headers.get('idempotency-key');
    const bodyAttemptId = typedBody.checkoutAttemptId;
    if (headerAttemptId !== null && bodyAttemptId !== undefined && headerAttemptId !== bodyAttemptId) return NextResponse.json({ error: '幂等键不一致' }, { status: 400 });
    const checkoutAttemptId = bodyAttemptId ?? headerAttemptId ?? undefined;
    if (checkoutAttemptId !== undefined && !validCheckoutAttemptId(checkoutAttemptId)) return NextResponse.json({ error: '幂等键格式无效' }, { status: 400 });

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

    const requestFingerprint = checkoutAttemptId
      ? buildCheckoutRequestFingerprint({ operation: 'order', actorId: session.user.id as string, organizationId: ownership.organizationId, ownerScope: ownership.ownerScope, request: body })
      : null;
    if (checkoutAttemptId) {
      const existing = await prisma.order.findUnique({ where: { checkoutAttemptId } });
      if (existing) {
        if (existing.customerId !== session.user.id || existing.organizationId !== ownership.organizationId || existing.ownerScope !== ownership.ownerScope || existing.checkoutRequestFingerprint !== requestFingerprint) {
          return NextResponse.json({ error: '幂等键已用于其他请求' }, { status: 409 });
        }
        return NextResponse.json({ order: existing, orderId: existing.id, replayed: true });
      }
    }

    const legalAcceptedAt = new Date();
    const { requiredIds: requiredLegalIds, snapshot: legalAcceptedSnapshot } =
      await getRequiredLegalConsent('checkout', legalAcceptedAt);
    const legalCheck = validateAcceptedLegalIds(acceptedLegalIds, requiredLegalIds);
    if (!legalCheck.ok) {
      return NextResponse.json({ error: '请先阅读并同意全部必同意协议后再下单' }, { status: 400 });
    }

    // Server-side price verification: never trust client-submitted prices
    const priced = dependencies.ready
      ? await unifiedOrderItems(dependencies.client, dependencies.createSnapshot, dependencies.resolveIdentities, items, session.user.id as string)
      : await verifyAndPriceItems(items, { userId: session.user.id as string, allowClientFallback: false, strictQuantity: true });
    const { verifiedItems, verifiedSubtotal, mismatchedCount } = priced;
    const sourceIndices = (verifiedItems as Array<VerifiedItem & { sourceIndex?: number }>).map((item, index) => item.sourceIndex ?? index);
    const unavailableItem = verifiedItems.find((item) => getVerifiedInventoryError(item));
    if (unavailableItem) {
      const inventoryError = getVerifiedInventoryError(unavailableItem);
      if (unavailableItem.variantId && inventoryError === 'INSUFFICIENT_STOCK') {
        return NextResponse.json({
          error: VARIANT_STOCK_INSUFFICIENT_MESSAGE,
          code: VARIANT_STOCK_INSUFFICIENT,
          catalogNumber: unavailableItem.catalogNumber,
        }, { status: 400 });
      }
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
      const raw = items[sourceIndices[idx]];
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
      const raw = items[sourceIndices[idx]] as { brand?: string | null; promoMark?: { ruleId: string; price?: number } | null } | undefined;
      return {
        product: {
          id: vi.productId ?? '',
          variantId: vi.variantId || undefined,
          selectedPromotionId: vi.selectedPromotionId ?? null,
          promotionIdentity: vi.promotionIdentity ?? { state: 'unknown' },
          promotionPricingEvidence: vi.promotionPricingEvidence,
          brand: vi.brand ?? raw?.brand ?? '',
          catalogNumber: vi.catalogNumber ?? '',
          name: vi.name ?? '',
          price: vi.unitPrice,
          spec: vi.spec ?? null,
          serverVerified: vi.source === 'db',
          category: vi.category ?? undefined,
          subcategory: vi.subcategory ?? undefined,
          delisted: vi.delisted === true,
        },
        quantity: vi.quantity,
        isQuickOrder: false,
        promoMark: raw?.promoMark ?? null,
      };
    });
    // The unified snapshot already validates marks and prices every static
    // candidate. Running the legacy engine here would apply them twice.
    const promoComputation = dependencies.ready
      ? { evals: [], adjustments: [], discountTotal: 0, lineDiscounts: {}, linePromotionLabels: {}, issues: [] }
      : computePromoAdjustments(promoLines, new Date());
    const { evals: promoEvals, adjustments: promoAdjustments, discountTotal: promoDiscountTotal } = promoComputation;
    if (dependencies.ready && unifiedCampaignOverlapsLegacyDiscounts(verifiedItems, promoComputation.lineDiscounts)) {
      return NextResponse.json({ error: '促销规则存在重复优惠，请刷新后重新确认', code: 'UNIFIED_LEGACY_PROMOTION_OVERLAP' }, { status: 409 });
    }
    if (!dependencies.ready) {
    const addonValidationError = validateAddonPromotionLines(promoLines, promoEvals);
    if (hasMisbrandedEligibleAddonMain(promoLines, promoEvals)) {
      return NextResponse.json({ error: '换购商品不符合活动范围，请刷新购物车后再试' }, { status: 400 });
    }
    const exceededOptionSelectionQuota = hasExceededSelectionAddonQuota(promoLines, promoEvals);
    if (addonValidationError && (exceededOptionSelectionQuota || !['ADDON_NOT_TRIGGERED', 'ADDON_QUOTA_EXCEEDED'].includes(addonValidationError))) {
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
    }

    // ── 优惠券（落地 5）：预评估（门槛/授权校验 + 金额），事务内原子核销防并发重复使用 ──
    const couponCodeNorm = typeof couponCode === 'string' && couponCode.trim() ? couponCode.trim() : '';
    let couponAdjustment: { type: string; label: string; amount: number; reason: string | null } | null = null;
    let couponScopedSubtotal = verifiedSubtotal;
    let couponSnapshot: CouponRedeemSnapshot | undefined;
    let couponRuleConfig: import('@/lib/cart-promotions/types').CouponRuleConfig | undefined;
    if (couponCodeNorm) {
      const { buildCouponRule } = await import('@/lib/coupon-service');
      const rule = await buildCouponRule(couponCodeNorm);
      if (!rule) {
        return NextResponse.json({ error: '优惠券不存在或不可用' }, { status: 400 });
      }
      couponRuleConfig = rule.config;
      const { promotionEngine } = await import('@/lib/cart-promotions/engine');
      const couponEval = promotionEngine.evaluateAll(promoLines, [rule.config], new Date())[0];
      if (!couponEval?.triggered || !couponEval.adjustments[0]) {
        const reason = couponEval?.details && typeof (couponEval.details as { couponAmount?: number }).couponAmount === 'number'
          ? couponEval.summary.replace(/^.*?：/, '')
          : '优惠券暂不可用';
        return NextResponse.json({ error: reason }, { status: 400 });
      }
      const scopedSubtotal = (couponEval.details as { subtotal?: number } | undefined)?.subtotal;
      if (typeof scopedSubtotal === 'number') couponScopedSubtotal = scopedSubtotal;
      couponSnapshot = {
        ...rule.snapshot,
        scopedSubtotal: couponScopedSubtotal,
        previewedDiscount: couponEval.adjustments[0].amount,
        promotionPricingEvidence: couponPromotionEvidenceForScope(
          promoLines,
          rule.config.scope ?? { type: 'all' },
        ) as CouponRedeemSnapshot['promotionPricingEvidence'],
      };
      if (rule.config.promotionPolicy) {
        const couponPolicyAudit = {
          policyFingerprint: rule.snapshot.promotionPolicyFingerprint,
          policy: rule.config.promotionPolicy,
          scope: rule.config.scope ?? { type: 'all' as const },
          eligibleSubtotal: couponScopedSubtotal,
          discount: couponEval.adjustments[0].amount,
        };
        orderItems.forEach((orderItem, index) => {
          const line = promoLines[index];
          const identity = line?.product.promotionIdentity;
          const inScope = Boolean(line && !line.isQuickOrder && !line.promoMark
            && couponLineIsInScope(line, rule.config.scope ?? { type: 'all' }));
          const excludedByPolicy = Boolean(inScope && rule.config.couponType === 'threshold'
            && rule.config.promotionPolicy?.state === 'restricted'
            && identity?.state === 'restricted'
            && rule.config.promotionPolicy.promotionIds.includes(identity.promotionId));
          let pricing: Record<string, unknown> = {};
          try { pricing = JSON.parse(orderItem.pricingSnapshot) as Record<string, unknown>; } catch { /* Keep the new audit record even if legacy pricing JSON is malformed. */ }
          orderItem.pricingSnapshot = JSON.stringify({
            ...pricing,
            couponPolicyAudits: [{ ...couponPolicyAudit, inScope, excludedByPolicy, identity: identity ?? { state: 'unknown' } }],
          });
        });
      }
      const scopeLabel = formatCouponScopeLabel(rule.config.scope ?? { type: 'all' });
      couponAdjustment = {
        type: 'coupon',
        label: rule.config.name,
        amount: -couponEval.adjustments[0].amount,
        reason: `券码 ${couponCodeNorm}${rule.config.stackable ? '（可叠加）' : ''} · ${scopeLabel}`,
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

    if (checkoutRevision) {
      const currentRevision = buildCheckoutRevision({ items: verifiedItems, adjustments, total: pointsBreakdown?.payableAfterPoints ?? amounts.total, points: pointsBreakdown });
      if (currentRevision !== checkoutRevision) {
        return NextResponse.json({ error: '结算价格已变化，请重新确认', code: 'CHECKOUT_REVISION_MISMATCH' }, { status: 409 });
      }
    }

    const orderCreatedAt = new Date();
    let order: Awaited<ReturnType<typeof prisma.order.create>>;
    try {
      order = await withAllocatedOrderNumber(prisma, async (tx, orderId) => {
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
          await assertVariantCheckoutStock(tx, orderItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            metadata: item.metadata,
          })));

          // Re-read ordinary prices, member inputs and database promotion evidence
          // inside the transaction before persisting the previously quoted order.
          const recheckPromise = dependencies.ready
            ? unifiedOrderItems(tx, dependencies.createSnapshot, dependencies.resolveIdentities, items, session.user.id as string)
            : verifyAndPriceItems(items, { db: tx, userId: session.user.id as string,
              allowClientFallback: false, strictQuantity: true });
          const rechecked = await recheckPromise.catch((error: unknown) => {
            if (error instanceof Error && ['REFERENCE_PRICE_PROMOTION_INVALID', 'CLIENT_FALLBACK_FORBIDDEN',
              'PRODUCT_VARIANT_NOT_FOUND', 'PRODUCT_VARIANT_MISMATCH', 'PRODUCT_REQUIRES_INQUIRY',
              'UNIFIED_PRICE_BANDS_UNSUPPORTED', 'UNIFIED_INSUFFICIENT_STOCK', 'UNIFIED_PRODUCT_OUT_OF_STOCK',
              'UNIFIED_REFERENCE_PRICE_PRICING_UNSUPPORTED', 'UNIFIED_PROMO_MARK_INVALID',
              'PROMOTION_ENUMERATION_LIMIT', 'PROMOTION_SOLVER_LIMIT', 'PROMOTION_PRICE_COVERAGE_REQUIRED',
              'UNIFIED_PROMOTION_ID_COLLISION'].includes(error.message)
              || error instanceof Error && (error.message.startsWith('UNIFIED_STATIC_')
                || error.message.startsWith('ADDON_') || error.message.startsWith('GIFT_'))) {
              throw new Error('CHECKOUT_PRICE_DRIFT');
            }
            throw error;
          });
          if (rechecked.verifiedItems.length !== verifiedItems.length || rechecked.verifiedItems.some((item, index) => {
            const original = verifiedItems[index];
            return item.productId !== original.productId || item.variantId !== original.variantId
              || item.quantity !== original.quantity || item.unitPrice !== original.unitPrice
              || JSON.stringify(stablePricingEvidence(item.pricingSnapshot)) !== JSON.stringify(stablePricingEvidence(original.pricingSnapshot));
          })) throw new Error('CHECKOUT_PRICE_DRIFT');
          if (dependencies.ready && 'evidenceHash' in priced && 'evidenceHash' in rechecked
            && priced.evidenceHash !== rechecked.evidenceHash) throw new Error('CHECKOUT_PRICE_DRIFT');

          const recheckedSourceIndices = (rechecked.verifiedItems as Array<VerifiedItem & { sourceIndex?: number }>).map((item, index) => item.sourceIndex ?? index);
          const recheckedPromoLines: CartLine[] = rechecked.verifiedItems.map((item, index) => {
            const raw = items[recheckedSourceIndices[index]] as { brand?: string | null; promoMark?: { ruleId: string; price?: number } | null } | undefined;
            return { product: { id: item.productId ?? '', variantId: item.variantId || undefined,
              selectedPromotionId: item.selectedPromotionId ?? null, promotionIdentity: item.promotionIdentity ?? { state: 'unknown' },
              promotionPricingEvidence: item.promotionPricingEvidence, brand: item.brand ?? raw?.brand ?? '',
              catalogNumber: item.catalogNumber ?? '', name: item.name ?? '', price: item.unitPrice, spec: item.spec ?? null,
              serverVerified: item.source === 'db', category: item.category ?? undefined, subcategory: item.subcategory ?? undefined,
              delisted: item.delisted === true }, quantity: item.quantity, isQuickOrder: false, promoMark: raw?.promoMark ?? null };
          });
          const transactionNow = new Date();
          const recheckedPromotions = dependencies.ready
            ? { evals: [], adjustments: [], discountTotal: 0, lineDiscounts: {}, linePromotionLabels: {}, issues: [] }
            : computePromoAdjustments(recheckedPromoLines, transactionNow);
          if (unifiedCampaignOverlapsLegacyDiscounts(rechecked.verifiedItems, recheckedPromotions.lineDiscounts)
            || JSON.stringify(recheckedPromotions.adjustments) !== JSON.stringify(promoAdjustments)
            || JSON.stringify(recheckedPromotions.evals) !== JSON.stringify(promoEvals)) throw new Error('CHECKOUT_PRICE_DRIFT');
          if (couponRuleConfig) {
            const { promotionEngine } = await import('@/lib/cart-promotions/engine');
            const currentCoupon = promotionEngine.evaluateAll(recheckedPromoLines, [couponRuleConfig], transactionNow)[0];
            const currentDiscount = currentCoupon?.adjustments[0]?.amount ?? 0;
            const currentScopedSubtotal = (currentCoupon?.details as { subtotal?: number } | undefined)?.subtotal;
            if (!currentCoupon?.triggered || !couponAdjustment || currentDiscount !== -couponAdjustment.amount
              || currentScopedSubtotal !== couponScopedSubtotal) throw new Error('CHECKOUT_PRICE_DRIFT');
          }

          // Recheck activity-bound prices in this transaction regardless of whether the order has a coupon.
          // Coupon identity uncertainty is handled by coupon scope checks and must not masquerade as price drift.
          const eligibleReferenceRows = verifiedItems.filter((item) => item.referencePriceEligible);
          const referencePriceEvidence = eligibleReferenceRows
            .map((item) => item.promotionPricingEvidence)
            .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
          if (referencePriceEvidence.length !== eligibleReferenceRows.length
            || !await revalidateReferencePriceEvidence(tx, referencePriceEvidence, new Date())) {
            throw new Error('REFERENCE_PRICE_DRIFT');
          }

          const created = await tx.order.create({
            data: {
              id: orderId,
              checkoutAttemptId: checkoutAttemptId ?? null,
              checkoutRequestFingerprint: requestFingerprint,
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

          await reserveOrderInventory(tx, created.id, session.user!.id as string, '下单预占规格库存', { variantLinesOnly: true });

          if (pointsBreakdown) {
            const applied = await applyOrderPointsDeduction(tx, created.id);
            if (!applied.ok) {
              throw new Error(`POINTS_APPLY:${applied.error}`);
            }
          }

          // 优惠券原子核销（事务内，防并发重复使用；失败则整单回滚）。
          // 绑定订单 id（redeemedOrderId），退款与审计可追溯。
          if (couponCodeNorm) {
            const redeemed = await redeemCoupon(tx, couponCodeNorm, session.user!.id as string, couponScopedSubtotal, created.id, couponSnapshot);
            if (!redeemed.ok) {
              throw new Error(`COUPON_APPLY:${redeemed.error}`);
            }
          }

          return created;
      }, orderCreatedAt);
    } catch (error) {
      if (isVariantStockInsufficientError(error)) {
        return NextResponse.json({ error: VARIANT_STOCK_INSUFFICIENT_MESSAGE, code: VARIANT_STOCK_INSUFFICIENT }, { status: 400 });
      }
      if (error instanceof Error && error.message.startsWith('COUPON_')) {
        const msg = error.message.replace(/^COUPON_APPLY:/, '');
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      if (error instanceof Error && error.message === 'REFERENCE_PRICE_DRIFT') {
        return NextResponse.json({ error: '活动参考价已变化，请刷新后重新确认', code: 'REFERENCE_PRICE_DRIFT' }, { status: 409 });
      }
      if (error instanceof Error && error.message === 'CHECKOUT_PRICE_DRIFT') {
        return NextResponse.json({ error: '结算价格或活动已变化，请刷新后重新确认', code: 'CHECKOUT_PRICE_DRIFT' }, { status: 409 });
      }
      if (error instanceof Error && error.message.startsWith('POINTS_')) {
        const msg = error.message.replace(/^POINTS_(PRECHECK|APPLY):/, '');
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      if (isUniqueConstraintError(error) && checkoutAttemptId && !isOrderIdUniqueConflict(error)) {
        const winner = await prisma.order.findUnique({ where: { checkoutAttemptId } });
        if (winner) {
          if (winner.customerId !== session.user.id || winner.organizationId !== ownership.organizationId || winner.ownerScope !== ownership.ownerScope || winner.checkoutRequestFingerprint !== requestFingerprint) {
            return NextResponse.json({ error: '幂等键已用于其他请求' }, { status: 409 });
          }
          return NextResponse.json({ order: winner, orderId: winner.id, replayed: true });
        }
      }
      throw error;
    }

    await prisma.notification.create({
      data: {
        email: 'admin',
        role: 'admin',
        type: 'order_created',
        title: '新订单',
        content: `新订单 ${order.id}，金额 ¥${amounts.total.toLocaleString()}`,
        linkUrl: '/admin/orders',
        metadata: JSON.stringify({ orderId: order.id }),
      },
    });

    sendAdminOperationalEmail({
      subject: 'LIBEREAL · 新订单',
      message: `新订单 ${order.id}，金额 ¥${amounts.total.toLocaleString()}`,
      path: '/admin/orders',
    });

    return NextResponse.json({ order, orderId: order.id });
  } catch (err) {
    if (err instanceof CustomerUnavailableProductError) {
      return NextResponse.json(
        { error: `${err.productName} 已下架，无法提交订单`, catalogNumber: err.catalogNumber },
        { status: 400 },
      );
    }
    if (err instanceof Error) {
      if (err.message === 'PROMOTION_UNIFIED_RUNTIME_REQUIRED') return NextResponse.json({ error: '促销定价暂不可用，请稍后重试', code: err.message }, { status: 503 });
      if (['UNIFIED_PROMO_MARK_UNSUPPORTED', 'UNIFIED_PROMO_MARK_INVALID', 'UNIFIED_PRICE_BANDS_UNSUPPORTED', 'UNIFIED_COUPON_EVIDENCE_UNSUPPORTED',
        'UNIFIED_REFERENCE_PRICE_PRICING_UNSUPPORTED', 'UNIFIED_REFERENCE_PRICE_CONFIG_INVALID', 'REFERENCE_PRICE_PROMOTION_INVALID',
        'PROMOTION_ENUMERATION_LIMIT', 'PROMOTION_SOLVER_LIMIT', 'UNIFIED_PROMOTION_ID_COLLISION', 'UNIFIED_STATIC_SOURCE_MAPPING_UNSUPPORTED', 'UNIFIED_STATIC_ADDON_OPTIONS_UNSUPPORTED',
        'UNIFIED_STATIC_BUY_N_GET_M_UNSUPPORTED', 'UNIFIED_STATIC_BUNDLE_UNSUPPORTED', 'UNIFIED_STATIC_STACK_DISCOUNT_UNSUPPORTED'].includes(err.message)
        || err.message.startsWith('UNIFIED_STATIC_') || err.message.startsWith('ADDON_') || err.message.startsWith('GIFT_')) {
        return NextResponse.json({ error: '当前价格或促销需要重新确认', code: err.message }, { status: 409 });
      }
      if (err.message === 'PROMOTION_PRICE_COVERAGE_REQUIRED') return NextResponse.json({ error: '部分商品没有可用价格，请询价或重新确认促销', code: err.message }, { status: 409 });
      if (err.message === 'UNIFIED_INSUFFICIENT_STOCK') {
        return NextResponse.json({ error: '库存不足，请刷新购物车后重试', code: 'INSUFFICIENT_STOCK' }, { status: 409 });
      }
      if (err.message === 'UNIFIED_PRODUCT_OUT_OF_STOCK') {
        return NextResponse.json({ error: '商品当前缺货，请刷新购物车后重试', code: 'PRODUCT_OUT_OF_STOCK' }, { status: 409 });
      }
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
    if (isOrderIdUniqueConflict(err)) {
      reportError(err, { tags: { route: 'orders', reason: 'order_number_conflict' }, extra: { method: 'POST' } });
      return NextResponse.json({ error: ORDER_NUMBER_BUSY_ERROR }, { status: 503 });
    }
    reportError(err, { tags: { route: 'orders' }, extra: { method: 'POST' } });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const productionPost = (req: NextRequest) => post(req, { ready: unifiedPromotionRuntimeEnabled(), client: prisma,
  createSnapshot: createUnifiedPricingSnapshot, resolveIdentities: resolveUnifiedPricingIdentities });
export const POST = Object.assign(productionPost, {
  forTest: (req: NextRequest, dependencies: Omit<UnifiedOrderDependencies, 'ready'>) => post(req, { ...dependencies, ready: true }),
  campaignOverlapsLegacyDiscountsForTest: unifiedCampaignOverlapsLegacyDiscounts,
});
