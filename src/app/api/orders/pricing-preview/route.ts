import { NextRequest, NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { AMBIGUOUS_PRODUCT_CATALOG_NUMBER, getVerifiedInventoryError, verifyAndPriceItems } from '@/lib/pricing';
import { calculateCheckoutFeeAdjustments } from '@/lib/checkout-fees';
import { isThirdPartyPaymentMethod } from '@/data/payment-methods';
import { calculateOrderAmounts } from '@/lib/order-domain';
import { previewPointsRedeem } from '@/lib/points-checkout-service';
import { normalizePointsIntent } from '@/lib/points-checkout';
import { computePromoAdjustments, hasExceededSelectionAddonQuota, hasMisbrandedEligibleAddonMain, validateAddonPromotionLines, validateGiftPromotionLines } from '@/lib/cart-promotions/service';
import type { CartLine } from '@/lib/cart-promotions/types';
import { buildCheckoutRevision } from '@/lib/checkout-revision';
import { customerVisiblePricingSnapshot } from '@/lib/commerce-records';
import { unifiedPromotionRuntimeEnabled } from '@/lib/unified-promotion-config';
import { buildCouponRule } from '@/lib/coupon-service';
import { formatCouponScopeLabel } from '@/lib/coupon-scope';
import { requireOrganizationPermission } from '@/lib/organization-service';
import type { Prisma } from '@prisma/client';
import type { VerifiedItem, PriceLookupItem, CouponPromotionPricingEvidence } from '@/lib/pricing';
import { createUnifiedPricingSnapshot, resolveUnifiedPricingIdentities, type UnifiedPricingIdentity, type UnifiedPricingSnapshot } from '@/lib/unified-pricing-snapshot';
import { allocateUnifiedBandsToSources } from '@/lib/unified-price-band-sources';

type UnifiedPreviewDependencies = {
  ready: boolean;
  client: typeof prisma;
  createSnapshot: typeof createUnifiedPricingSnapshot;
  resolveIdentities: typeof resolveUnifiedPricingIdentities;
};

function unifiedCampaignOverlapsLegacyDiscounts(items: VerifiedItem[], discounts: Record<string, number>): boolean {
  return items.some((item, index) => Boolean((item as VerifiedItem & { unifiedOccupiedPromotionId?: string | null }).unifiedOccupiedPromotionId
    ?? item.selectedPromotionId) && (discounts[String(index)] ?? 0) > 0);
}

function promotionIdentityFor(snapshot: UnifiedPricingSnapshot, productId: string, variantId: string | null, promotionId: string | null) {
  if (promotionId && snapshot.evidence.promotions.some((promotion) => promotion.id === promotionId)) {
    return { state: 'restricted' as const, promotionId };
  }
  // Preserve static rule identity separately from database Promotion IDs.
  if (promotionId?.startsWith('legacy-cart:')) {
    const rule = snapshot.evidence.legacyCartPromotions.find((entry) => entry.id === promotionId);
    if (!rule) throw new Error('UNIFIED_PRICING_PROMOTION_INCOMPLETE');
    return { state: 'static' as const, ruleId: rule.id, versionHash: rule.versionHash };
  }
  const product = snapshot.evidence.products.find((item) => item.id === productId);
  const variant = product?.variants.find((item) => item && typeof item === 'object' && 'id' in item && item.id === variantId) as { promotionalPrice?: number | null } | undefined;
  const syntheticPrice = (product?.promotionalPrice ?? 0) > 0 || (variant?.promotionalPrice ?? 0) > 0;
  const activeBinding = snapshot.evidence.promotions.some((promotion) => promotion.status === 'active'
    && Date.parse(promotion.startsAt) <= Date.parse(snapshot.evidence.at)
    && Date.parse(promotion.endsAt) > Date.parse(snapshot.evidence.at)
    && promotion.bindings.some((binding) => binding.productId === productId
      && (binding.variantId === variantId || binding.variantId === null)));
  return !syntheticPrice && !activeBinding ? { state: 'knownnone' as const } : { state: 'unknown' as const };
}

function couponEvidenceFor(snapshot: UnifiedPricingSnapshot, productId: string, variantId: string | null, identity: ReturnType<typeof promotionIdentityFor>): CouponPromotionPricingEvidence {
  const product = snapshot.evidence.products.find((item) => item.id === productId)!;
  if (typeof product.price !== 'number' || !Number.isFinite(product.price)) throw new Error('UNIFIED_COUPON_EVIDENCE_UNSUPPORTED');
  const variant = product.variants.find((item) => item && typeof item === 'object' && 'id' in item && item.id === variantId) as { id: string; price: number | null; promotionalPrice: number | null; minimumSalePrice: number | null } | undefined;
  const links = product.promotionLinks as Array<{ id: string; productId: string; variantId: string | null; groupKey: string; promotionId: string }>;
  return {
    productId, variantId, pricedAt: snapshot.evidence.at, identity,
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

async function unifiedVerifiedItems(
  client: typeof prisma,
  createSnapshot: typeof createUnifiedPricingSnapshot,
  resolveIdentities: typeof resolveUnifiedPricingIdentities,
  rawItems: PriceLookupItem[],
  userId: string,
): Promise<{ verifiedItems: VerifiedItem[]; displayItems?: Array<Omit<VerifiedItem, 'unitPrice'> & { unitPrice: number | null }>; verifiedSubtotal: number; mismatchedCount: number }> {
  const now = new Date();
  return client.$transaction(async (tx) => {
    const identities: UnifiedPricingIdentity[] = [];
    for (const item of rawItems) {
      identities.push((await resolveIdentities(tx as Prisma.TransactionClient, { lines: [{ productId: item.productId, catalogNumber: item.catalogNumber, variantId: item.variantId, brand: item.brand, quantity: item.quantity! }] })).items[0]);
    }
    const grouped = new Map<string, { productId: string; variantId: string | null; quantity: number; sourceIndexes: number[] }>();
    identities.forEach((identity, index) => {
      const entry = grouped.get(identity.id) ?? { productId: identity.productId, variantId: identity.variantId, quantity: 0, sourceIndexes: [] };
      entry.quantity += identity.quantity;
      if (!Number.isSafeInteger(entry.quantity)) throw new Error('INVALID_QUANTITY');
      entry.sourceIndexes.push(index);
      grouped.set(identity.id, entry);
    });
    for (const group of grouped.values()) {
      const identity = identities[group.sourceIndexes[0]];
      if (!identity.available) throw new Error('UNIFIED_PRODUCT_OUT_OF_STOCK');
      if (identity.stockQuantity != null && identity.stockQuantity >= 0 && identity.stockQuantity < group.quantity) throw new Error('UNIFIED_INSUFFICIENT_STOCK');
    }
    const groups = [...grouped.entries()];
    const snapshot = await createSnapshot(tx as Prisma.TransactionClient, { lines: identities.map((identity, sourceIndex) => ({
      productId: identity.productId, variantId: identity.variantId, quantity: identity.quantity,
      promoMark: rawItems[sourceIndex]?.promoMark ?? null,
    })), userId, now });
    const resultBySku = new Map(snapshot.pricing.lines.map((line) => [JSON.stringify([line.productId, line.variantId]), line]));
    const productById = new Map(snapshot.evidence.products.map((product) => [product.id, product]));
    const rows: Array<{ item: VerifiedItem & { sourceIndex: number }; sourceIndex: number }> = [];
    let verifiedSubtotalCents = BigInt(0);
    for (const [skuKey, group] of groups) {
      const result = resultBySku.get(skuKey);
      const sourceIdentity = identities[group.sourceIndexes[0]];
      if (!result || result.quantity !== group.quantity || !Number.isSafeInteger(result.totalAfterCents) || result.totalAfterCents < 0) throw new Error('INVALID_PROMOTION_PLAN');
      const product = productById.get(group.productId);
      if (!product) throw new Error('UNIFIED_PRICING_PRODUCT_NOT_FOUND');
      const ordinaryCents = snapshot.evidence.ordinaryUnitPricesCents[group.sourceIndexes[0]] ?? null;
      const nativePriceBands = (result as typeof result & { priceBands?: Array<{ quantity: number; unitCents: number; source: 'ordinary' | 'promotion'; sourceLineId?: string }> }).priceBands;
      const bands = nativePriceBands ?? (result.promotionId === null && ordinaryCents !== null
        && group.sourceIndexes.every((index) => snapshot.evidence.ordinaryUnitPricesCents[index] === ordinaryCents)
        && ordinaryCents * group.quantity === result.totalAfterCents
        ? [{ quantity: group.quantity, unitCents: ordinaryCents, source: 'ordinary' as const }]
        : null);
      if (!bands || bands.some((band) => !Number.isSafeInteger(band.quantity) || band.quantity <= 0
        || !Number.isSafeInteger(band.unitCents) || band.unitCents < 0
        || !['ordinary', 'promotion'].includes(band.source))) throw new Error('UNIFIED_PRICE_BANDS_UNSUPPORTED');
      const bandsQuantity = bands.reduce((sum, band) => sum + BigInt(band.quantity), BigInt(0));
      const bandsTotalCents = bands.reduce((sum, band) => sum + BigInt(band.quantity) * BigInt(band.unitCents), BigInt(0));
      if (bandsQuantity !== BigInt(group.quantity)
        || bandsTotalCents !== BigInt(result.totalAfterCents) || bandsTotalCents > BigInt(Number.MAX_SAFE_INTEGER)
        || bands.some((band) => band.source === 'promotion' && !result.promotionId)) {
        throw new Error('UNIFIED_PRICE_BANDS_UNSUPPORTED');
      }
      verifiedSubtotalCents += bandsTotalCents;
      if (verifiedSubtotalCents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_PROMOTION_AMOUNT');
      const allocations = allocateUnifiedBandsToSources(bands, group.sourceIndexes.map((sourceIndex) => {
        const mark = rawItems[sourceIndex]?.promoMark;
        return { sourceIndex, quantity: identities[sourceIndex].quantity,
          semantics: JSON.stringify([identities[sourceIndex].id, snapshot.evidence.ordinaryUnitPricesCents[sourceIndex] ?? null,
            mark?.ruleId ?? null, mark?.price ?? null, rawItems[sourceIndex]?.unit ?? null]) };
      }));
      for (const { sourceIndex, band, quantity } of allocations) {
          const unitPrice = band.unitCents / 100;
          const rowTotalCents = BigInt(band.unitCents) * BigInt(quantity);
          if (rowTotalCents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_PROMOTION_AMOUNT');
          const bandPromotionId = band.source === 'promotion' ? result.promotionId : null;
          const identityPromotionId = result.occupiedPromotionId?.startsWith('legacy-cart:') ? result.occupiedPromotionId : bandPromotionId;
          const selectedIdentity = promotionIdentityFor(snapshot, group.productId, group.variantId, identityPromotionId);
          const evidence = couponEvidenceFor(snapshot, group.productId, group.variantId, selectedIdentity);
          rows.push({ sourceIndex, item: {
            productId: sourceIdentity.productId, catalogNumber: sourceIdentity.catalogNumber, brand: sourceIdentity.brand,
            name: sourceIdentity.name, unitPrice,
            baseUnitPrice: snapshot.evidence.ordinaryUnitPricesCents[sourceIndex] == null ? undefined : snapshot.evidence.ordinaryUnitPricesCents[sourceIndex]! / 100,
            quantity, lineTotal: Number(rowTotalCents) / 100, priceMismatch: false, source: 'db',
            variantId: sourceIdentity.variantId, spec: sourceIdentity.spec, unit: rawItems[sourceIndex]?.unit ?? null,
            category: sourceIdentity.category, subcategory: sourceIdentity.subcategory, selectedPromotionId: bandPromotionId,
            unifiedOccupiedPromotionId: result.occupiedPromotionId,
            promotionIdentity: selectedIdentity, promotionPricingEvidence: evidence, pricingAt: snapshot.evidence.at,
            referencePriceEligible: Boolean(snapshot.evidence.referencePricePromotionId && group.variantId === null),
            referencePriceApplied: Boolean(snapshot.evidence.referencePricePromotionId && selectedIdentity.state === 'restricted' && selectedIdentity.promotionId === snapshot.evidence.referencePricePromotionId),
            delisted: sourceIdentity.deletedAt !== null, available: sourceIdentity.available, leadTime: sourceIdentity.leadTime,
            stockQuantity: sourceIdentity.stockQuantity,
            sourceIndex,
            pricingSnapshot: JSON.stringify({ calculatedAt: snapshot.evidence.at, finalPrice: unitPrice,
              appliedSource: bandPromotionId ? `promotion:${bandPromotionId}` : 'unified_ordinary_price',
              unifiedPricingEvidenceHash: snapshot.evidenceHash, unifiedLineTotalCents: result.totalAfterCents,
              couponPromotionIdentity: selectedIdentity, couponPromotionPricingEvidence: evidence,
              referencePricePromotionId: snapshot.evidence.referencePricePromotionId, referencePriceApplied: evidence.referencePriceApplied,
              referencePriceEligible: evidence.referencePriceEligible }),
          } });
      }
    }
    rows.sort((a, b) => a.sourceIndex - b.sourceIndex || b.item.unitPrice - a.item.unitPrice);
    const displayItems = identities.map((identity, sourceIndex) => {
      const sourceRows = rows.filter((entry) => entry.sourceIndex === sourceIndex).map((entry) => entry.item);
      const lineTotalCents = sourceRows.reduce((sum, item) => sum + BigInt(Math.round(item.lineTotal * 100)), BigInt(0));
      const lineTotal = Number(lineTotalCents) / 100;
      const distinctPrices = new Set(sourceRows.map((item) => item.unitPrice));
      return { ...sourceRows[0], quantity: identity.quantity, unitPrice: distinctPrices.size === 1 ? sourceRows[0].unitPrice : null, lineTotal };
    });
    return { verifiedItems: rows.map((entry) => entry.item), displayItems, verifiedSubtotal: Number(verifiedSubtotalCents) / 100, mismatchedCount: 0 };
  });
}

async function post(req: NextRequest, dependencies: UnifiedPreviewDependencies) {
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

    const priced = dependencies.ready
      ? await unifiedVerifiedItems(dependencies.client, dependencies.createSnapshot, dependencies.resolveIdentities, body.items as PriceLookupItem[], session.user.id as string)
      : await verifyAndPriceItems(body.items, { userId: session.user.id as string, allowClientFallback: false, strictQuantity: true });
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
    const sourceIndices = (priced.verifiedItems as Array<VerifiedItem & { sourceIndex?: number }>).map((item, index) => item.sourceIndex ?? index);
    const promoLines: CartLine[] = priced.verifiedItems.map((vi, idx) => {
      const raw = (body.items as Array<{ brand?: string | null; promoMark?: { ruleId: string; price?: number } | null }>)[sourceIndices[idx]];
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

    const promoComputation = dependencies.ready
      ? { evals: [], adjustments: [], discountTotal: 0, lineDiscounts: {}, linePromotionLabels: {}, issues: [] }
      : computePromoAdjustments(promoLines, new Date());
    if (dependencies.ready && unifiedCampaignOverlapsLegacyDiscounts(priced.verifiedItems, promoComputation.lineDiscounts)) {
      return NextResponse.json({ error: '促销规则存在重复优惠，请刷新后重新确认', code: 'UNIFIED_LEGACY_PROMOTION_OVERLAP' }, { status: 409 });
    }
    if (!dependencies.ready) {
    const addonValidationError = validateAddonPromotionLines(promoLines, promoComputation.evals);
    if (hasMisbrandedEligibleAddonMain(promoLines, promoComputation.evals)) {
      return NextResponse.json({ error: '换购商品不符合活动范围，请刷新购物车后再试' }, { status: 400 });
    }
    const exceededOptionSelectionQuota = hasExceededSelectionAddonQuota(promoLines, promoComputation.evals);
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
    const giftValidationError = validateGiftPromotionLines(promoLines, promoComputation.evals);
    if (giftValidationError) {
      return NextResponse.json({ error: '赠品促销资格无效，请刷新购物车后再试', code: giftValidationError }, { status: 400 });
    }
    }
    const { adjustments: promoAdjustments, discountTotal: promoDiscountTotal } = promoComputation;

    // ── 优惠券（落地 5）：满减/无门槛券，服务端重新评估（防前端改价）──
    let couponAdjustment: { type: string; label: string; amount: number; reason: string | null; scopeLabel: string } | null = null;
    let couponError: string | null = null;
    let couponScopeLabel: string | null = null;
    const couponCode = typeof body.couponCode === 'string' && body.couponCode.trim() ? body.couponCode.trim() : '';
    if (couponCode) {
      const rule = await buildCouponRule(couponCode);
      if (!rule) {
        couponError = '优惠券不存在或不可用';
      } else {
        couponScopeLabel = formatCouponScopeLabel(rule.config.scope ?? { type: 'all' });
        // 券门槛基于范围内商品小计（不含券本身优惠，已下架商品不计入）
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
            reason: `券码 ${couponCode}${rule.config.stackable ? '（可叠加）' : ''} · ${couponScopeLabel}`,
            scopeLabel: couponScopeLabel,
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
    const previewDisplayItems = (priced as typeof priced & {
      displayItems?: Array<Omit<VerifiedItem, 'unitPrice'> & { unitPrice: number | null }>;
    }).displayItems;

    return NextResponse.json({
      subtotal: amounts.subtotal,
      promotionDiscount: promoDiscountTotal,
      promotionAdjustments: promoAdjustments,
      adjustmentTotal: amounts.adjustmentTotal,
      // Keep cart-promotion adjustments in the preview so checkout can explain
      // the authoritative total without recomputing discounts in the browser.
      adjustments: [...allAdjustments, ...(pointsBreakdown && pointsBreakdown.pointsDiscount > 0 ? [{ type: 'points_redeem', amount: -pointsBreakdown.pointsDiscount }] : [])],
      coupon: couponAdjustment,
      couponError,
      couponScopeLabel,
      totalBeforePoints: amounts.total,
      points: pointsBreakdown,
      total: payable,
      checkoutRevision: buildCheckoutRevision({ items: priced.verifiedItems, adjustments: [...allAdjustments, ...(pointsBreakdown && pointsBreakdown.pointsDiscount > 0 ? [{ type: 'points_redeem', amount: -pointsBreakdown.pointsDiscount }] : [])], total: payable, points: pointsBreakdown }),
      items: (previewDisplayItems ?? priced.verifiedItems).map((item, sourceIndex) => {
        const rowIndexes = sourceIndices.map((lineSourceIndex, rowIndex) => lineSourceIndex === sourceIndex ? rowIndex : -1).filter((rowIndex) => rowIndex >= 0);
        const promotionDiscount = rowIndexes.reduce((sum, rowIndex) => sum + (promoComputation.lineDiscounts[String(rowIndex)] ?? 0), 0);
        const promotionLabels = [...new Set(rowIndexes.flatMap((rowIndex) => promoComputation.linePromotionLabels[String(rowIndex)] ?? []))];
        const sourceRows = rowIndexes.map((rowIndex) => priced.verifiedItems[rowIndex]);
        const hasComparableBase = dependencies.ready && sourceRows.some((row) => row.selectedPromotionId)
          && sourceRows.every((row) => typeof row.baseUnitPrice === 'number' && row.baseUnitPrice > 0);
        const includedPromotionDiscount = hasComparableBase ? Math.max(0, Math.round(sourceRows.reduce((sum, row) =>
          sum + (row.baseUnitPrice! - row.unitPrice) * row.quantity * 100, 0)) / 100) : 0;
        const originalUnitPrice = hasComparableBase && sourceRows.every((row) => row.baseUnitPrice === sourceRows[0].baseUnitPrice)
          ? sourceRows[0].baseUnitPrice : null;
        const priceTiers = rowIndexes.map((rowIndex) => priced.verifiedItems[rowIndex]).reduce<Array<{ unitPrice: number; quantity: number }>>((tiers, line) => {
          const existing = tiers.find((tier) => tier.unitPrice === line.unitPrice);
          if (existing) existing.quantity += line.quantity;
          else tiers.push({ unitPrice: line.unitPrice, quantity: line.quantity });
          return tiers;
        }, []);
        return {
          productId: item.productId, catalogNumber: item.catalogNumber, unitPrice: item.unitPrice,
          ...(previewDisplayItems ? { priceTiers } : {}),
          quantity: item.quantity, lineTotal: item.lineTotal,
          finalUnitPrice: item.unitPrice == null ? null : item.unitPrice - promotionDiscount / Math.max(1, item.quantity),
          finalLineTotal: item.lineTotal - promotionDiscount, promotionDiscount, promotionLabels,
          ...(dependencies.ready ? { includedPromotionDiscount, originalUnitPrice } : {}),
          available: item.available, leadTime: item.leadTime, stockQuantity: item.stockQuantity,
          pricingSnapshot: customerVisiblePricingSnapshot(item.pricingSnapshot),
        };
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'PROMOTION_UNIFIED_RUNTIME_REQUIRED') return NextResponse.json({ error: '促销定价暂不可用，请稍后重试', code: message }, { status: 503 });
    if (message === 'UNIFIED_PROMO_MARK_UNSUPPORTED' || message === 'UNIFIED_PROMO_MARK_INVALID' || message === 'UNIFIED_REFERENCE_PRICE_PRICING_UNSUPPORTED'
      || message === 'UNIFIED_REFERENCE_PRICE_CONFIG_INVALID' || message === 'UNIFIED_PRICE_BANDS_UNSUPPORTED'
      || message === 'UNIFIED_COUPON_EVIDENCE_UNSUPPORTED' || message === 'REFERENCE_PRICE_PROMOTION_INVALID'
      || message === 'PROMOTION_ENUMERATION_LIMIT' || message === 'PROMOTION_SOLVER_LIMIT'
      || message === 'UNIFIED_PROMOTION_ID_COLLISION' || message.startsWith('UNIFIED_STATIC_')
      || message.startsWith('ADDON_') || message.startsWith('GIFT_')) {
      return NextResponse.json({ error: '当前促销组合需要重新确认', code: message }, { status: 409 });
    }
    if (message === 'PROMOTION_PRICE_COVERAGE_REQUIRED') return NextResponse.json({ error: '部分商品没有可用价格，请询价或重新确认促销', code: message }, { status: 409 });
    if (message === 'UNIFIED_INSUFFICIENT_STOCK') return NextResponse.json({ error: '库存不足，请刷新购物车后重试', code: 'INSUFFICIENT_STOCK' }, { status: 409 });
    if (message === 'UNIFIED_PRODUCT_OUT_OF_STOCK') return NextResponse.json({ error: '商品当前缺货，请刷新购物车后重试', code: 'PRODUCT_OUT_OF_STOCK' }, { status: 409 });
    if (message === 'PRODUCT_REQUIRES_INQUIRY' || message === 'INVALID_FALLBACK_PRICE' || message === 'CLIENT_FALLBACK_FORBIDDEN' || message === 'INVALID_QUANTITY' || message === 'INVALID_ITEM_QUANTITY' || message === 'PRODUCT_VARIANT_NOT_FOUND' || message === 'PRODUCT_VARIANT_MISMATCH' || message === 'PRODUCT_CATALOG_MISMATCH' || message === 'PRODUCT_BRAND_MISMATCH' || message === AMBIGUOUS_PRODUCT_CATALOG_NUMBER) {
      return NextResponse.json({ error: '部分商品价格需要重新确认' }, { status: 400 });
    }
    console.error('[orders/pricing-preview POST] error:', error);
    return NextResponse.json({ error: '价格计算失败' }, { status: 500 });
  }
}

const productionPost = (req: NextRequest) => post(req, { ready: unifiedPromotionRuntimeEnabled(), client: prisma,
  createSnapshot: createUnifiedPricingSnapshot, resolveIdentities: resolveUnifiedPricingIdentities });
export const POST = Object.assign(productionPost, {
  forTest: (req: NextRequest, dependencies: Omit<UnifiedPreviewDependencies, 'ready'>) => post(req, { ...dependencies, ready: true }),
});
