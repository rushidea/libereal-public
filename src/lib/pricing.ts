import { prisma } from '@/lib/prisma';
import { calculatePrice, type PriceAdjustment, type PromotionCandidate } from '@/lib/price-engine';
import { lookupBrandDiscountRate } from '@/lib/discount-brand-catalog';
import type { Prisma } from '@prisma/client';

const pricingVariantSelect = {
  id: true,
  catalogNumber: true,
  spec: true,
  price: true,
  promotionalPrice: true,
  minimumSalePrice: true,
  productId: true,
  inventoryAccounts: { select: { availableQuantity: true }, take: 1 },
} satisfies Prisma.ProductVariantSelect;

export const AMBIGUOUS_PRODUCT_CATALOG_NUMBER = 'AMBIGUOUS_PRODUCT_CATALOG_NUMBER';

export interface PriceLookupItem {
  productId?: string | null;
  catalogNumber?: string | null;
  brand?: string | null;
  name: string;
  price: number;
  quantity?: number;
  variantId?: string | null;
  spec?: string | null;
  unit?: string | null;
  /**
   * 购物车促销标记（换购/赠品行）：服务端按原价计价、不叠加会员/品牌折扣与促销价，
   * 活动优惠由下单 API 统一按订单级负调整扣减（对应 cart-promotions 引擎）。
   */
  promoMark?: { ruleId: string; price?: number; choice?: string } | null;
}

export interface VerifiedItem {
  productId: string | null;
  catalogNumber: string | null;
  /** 数据库匹配到的品牌，用于服务端校验促销标记行。 */
  brand?: string | null;
  name: string;
  unitPrice: number;
  baseUnitPrice?: number;
  quantity: number;
  lineTotal: number;
  priceMismatch: boolean;
  clientPrice?: number;
  source: 'db' | 'fallback';
  /** Quote-required lines have no authoritative unit price yet. */
  quoteRequired?: boolean;
  variantId?: string | null;
  spec?: string | null;
  unit?: string | null;
  /** Product.category，优惠券品类范围用。 */
  category?: string | null;
  /** Product.subcategory，优惠券品类范围用。 */
  subcategory?: string | null;
  /** Trusted Promotion table identity if established; null does not imply no active restriction. */
  selectedPromotionId?: string | null;
  /** True only when this line's unit price came from the configured reference price activity. */
  referencePriceApplied?: boolean;
  /** Eligible product-level checkout line; used to detect newly effective target activity. */
  referencePriceEligible?: boolean;
  promotionIdentity?: import('@/lib/coupon-scope').CouponPromotionIdentity;
  promotionPricingEvidence?: CouponPromotionPricingEvidence;
  pricingAt?: string;
  /** Product.deletedAt 非空。优惠券不算入范围，计价本身不因下架改价。 */
  delisted?: boolean;
  available?: boolean | null;
  leadTime?: string | null;
  stockQuantity?: number | null;
  pricingSnapshot: string;
}

export type CouponPromotionPricingEvidence = {
  productId: string;
  variantId: string | null;
  pricedAt: string;
  identity: import('@/lib/coupon-scope').CouponPromotionIdentity;
  product: { price: number; originalPrice?: number | null; promotionalPrice: number | null; minimumSalePrice: number | null };
  variant: { price: number | null; promotionalPrice: number | null; minimumSalePrice: number | null } | null;
  candidates: Array<{
    bindingId: string;
    productId: string;
    variantId: string | null;
    groupKey: string;
    promotion: { id: string; type: string; value: number; ruleDefinition: string | null; ruleVersion: number;
      status: string; startsAt: string; endsAt: string; priority: number; exclusive: boolean };
  }>;
  referencePricePromotionId?: string | null;
  referencePriceScope?: string | null;
  referencePriceApplied?: boolean;
  referencePriceEligible?: boolean;
};

/** Optional, server-only opt-in. A malformed configured value disables application and makes identity unknown. */
type ReferenceConfig = { promotionId: string; scope?: { productId: string; rate: number; startsAt: string; endsAt: string } };
function referencePricePromotionConfig(): ReferenceConfig | null | 'unknown' {
  const raw = process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
    const record = value as Record<string, unknown>;
    if (typeof record.promotionId !== 'string' || !record.promotionId.trim()) return 'unknown';
    if (Object.keys(record).length === 1) return { promotionId: record.promotionId.trim() };
    if (Object.keys(record).sort().join(',') !== 'endsAt,productId,promotionId,rate,startsAt'
      || typeof record.productId !== 'string' || !record.productId.trim()
      || typeof record.rate !== 'number' || !Number.isFinite(record.rate) || record.rate <= 0 || record.rate > 1
      || typeof record.startsAt !== 'string' || typeof record.endsAt !== 'string') return 'unknown';
    const start = new Date(record.startsAt); const end = new Date(record.endsAt);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())
      || start.toISOString() !== record.startsAt || end.toISOString() !== record.endsAt || start >= end) return 'unknown';
    return { promotionId: record.promotionId.trim(), scope: { productId: record.productId.trim(), rate: record.rate,
      startsAt: record.startsAt, endsAt: record.endsAt } };
  } catch {
    return 'unknown';
  }
}

function promotionPricingEvidence(
  product: PricingProduct,
  variant: { id: string; productId: string; price: number; promotionalPrice: number | null; minimumSalePrice: number | null } | null,
  now: Date,
): CouponPromotionPricingEvidence {
  const variantId = variant?.id ?? null;
  const referenceConfig = referencePricePromotionConfig();
  return {
    productId: product.id,
    variantId,
    pricedAt: now.toISOString(),
    identity: { state: 'unknown' },
    product: { price: product.price, originalPrice: product.originalPrice, promotionalPrice: product.promotionalPrice, minimumSalePrice: product.minimumSalePrice },
    variant: variant ? { price: variant.price, promotionalPrice: variant.promotionalPrice, minimumSalePrice: variant.minimumSalePrice } : null,
    candidates: product.promotionLinks
      .filter((link) => !link.variantId || link.variantId === variantId)
      .map((link) => ({
        bindingId: link.id,
        productId: link.productId,
        variantId: link.variantId,
        groupKey: link.groupKey,
        promotion: {
          id: link.promotion.id,
          type: link.promotion.type,
          value: link.promotion.value,
          ruleDefinition: link.promotion.ruleDefinition,
          ruleVersion: link.promotion.ruleVersion,
          status: link.promotion.status,
          startsAt: link.promotion.startsAt.toISOString(),
          endsAt: link.promotion.endsAt.toISOString(),
          priority: link.promotion.priority,
          exclusive: link.promotion.exclusive,
        },
      }))
      .sort((a, b) => a.bindingId.localeCompare(b.bindingId)),
    ...(referenceConfig && referenceConfig !== 'unknown' && referenceConfig.scope
      ? { referencePriceScope: JSON.stringify(referenceConfig.scope) } : {}),
    referencePricePromotionId: referenceConfig === 'unknown' ? 'unknown' : referenceConfig?.promotionId ?? null,
  };
}

export type InventoryValidationError = 'PRODUCT_OUT_OF_STOCK' | 'INSUFFICIENT_STOCK';

/** Customer checkout rejects stale or unavailable stock snapshots. */
export function getVerifiedInventoryError(item: VerifiedItem): InventoryValidationError | null {
  if (item.available === false) return 'PRODUCT_OUT_OF_STOCK';
  if (item.stockQuantity != null && item.stockQuantity >= 0 && item.stockQuantity < item.quantity) {
    return 'INSUFFICIENT_STOCK';
  }
  return null;
}

export interface PricingContext {
  userId?: string | null;
  customerEmail?: string | null;
  now?: Date;
  manualAdjustments?: Record<string, PriceAdjustment>;
  allowManualAdjustment?: boolean;
  /** Admin-created orders may include hazardous SKUs; customer flows must not. */
  allowHazardousProducts?: boolean;
  /** Customer checkout must never persist a client-supplied price fallback. */
  allowClientFallback?: boolean;
  /** Checkout/order APIs require an explicit finite positive integer quantity. */
  strictQuantity?: boolean;
  /** Inquiry submission may preserve unresolved lines without pricing them. */
  allowQuoteRequired?: boolean;
}

export class CustomerUnavailableProductError extends Error {
  catalogNumber: string;
  productName: string;

  constructor(catalogNumber: string, productName: string) {
    super(`Product ${catalogNumber} is unavailable to customers`);
    this.name = 'CustomerUnavailableProductError';
    this.catalogNumber = catalogNumber;
    this.productName = productName;
  }
}

/** Compare every pricing-relevant Promotion binding and value inside the checkout transaction. */
export async function revalidateCouponPromotionEvidence(
  tx: Prisma.TransactionClient,
  evidence: CouponPromotionPricingEvidence[],
  transactionNow: Date,
): Promise<boolean> {
  for (const expected of evidence) {
    const pricedAt = new Date(expected.pricedAt);
    if (!Number.isFinite(pricedAt.getTime())) return false;
    const product = await tx.product.findUnique({
      where: { id: expected.productId },
      select: { id: true, price: true, originalPrice: true, promotionalPrice: true, minimumSalePrice: true },
    });
    if (!product) return false;
    const variant = expected.variantId
      ? await tx.productVariant.findUnique({
        where: { id: expected.variantId },
        select: { id: true, productId: true, price: true, promotionalPrice: true, minimumSalePrice: true },
      })
      : null;
    if (expected.variantId && (!variant || variant.productId !== expected.productId)) return false;
    const where = expected.variantId
      ? { productId: expected.productId, OR: [{ variantId: null }, { variantId: expected.variantId }] }
      : { productId: expected.productId, variantId: null };
    const bindings = await tx.promotionProduct.findMany({
      where,
      select: {
        id: true, productId: true, variantId: true, groupKey: true,
        promotion: { select: {
          id: true, type: true, value: true, ruleDefinition: true, ruleVersion: true,
          status: true, startsAt: true, endsAt: true, priority: true, exclusive: true,
        } },
      },
    });
    const currentReferenceConfig = referencePricePromotionConfig();
    const actual: CouponPromotionPricingEvidence = {
      productId: product.id,
      variantId: variant?.id ?? null,
      pricedAt: expected.pricedAt,
      identity: expected.identity,
      product: { price: product.price, ...(Object.hasOwn(expected.product, 'originalPrice') || currentReferenceConfig !== null
        ? { originalPrice: product.originalPrice } : {}), promotionalPrice: product.promotionalPrice, minimumSalePrice: product.minimumSalePrice },
      variant: variant ? { price: variant.price, promotionalPrice: variant.promotionalPrice, minimumSalePrice: variant.minimumSalePrice } : null,
      candidates: bindings.map((link) => ({
        bindingId: link.id,
        productId: link.productId,
        variantId: link.variantId,
        groupKey: link.groupKey,
        promotion: {
          id: link.promotion.id,
          type: link.promotion.type,
          value: link.promotion.value,
          ruleDefinition: link.promotion.ruleDefinition,
          ruleVersion: link.promotion.ruleVersion,
          status: link.promotion.status,
          startsAt: link.promotion.startsAt.toISOString(),
          endsAt: link.promotion.endsAt.toISOString(),
          priority: link.promotion.priority,
          exclusive: link.promotion.exclusive,
        },
      })).sort((a, b) => a.bindingId.localeCompare(b.bindingId)),
      ...(Object.hasOwn(expected, 'referencePriceScope') || (currentReferenceConfig && currentReferenceConfig !== 'unknown' && currentReferenceConfig.scope)
        ? { referencePriceScope: currentReferenceConfig && currentReferenceConfig !== 'unknown' && currentReferenceConfig.scope ? JSON.stringify(currentReferenceConfig.scope) : null } : {}),
      ...(Object.hasOwn(expected, 'referencePricePromotionId') || currentReferenceConfig !== null
        ? { referencePricePromotionId: currentReferenceConfig === 'unknown' ? 'unknown' : currentReferenceConfig?.promotionId ?? null }
        : {}),
      ...(Object.hasOwn(expected, 'referencePriceApplied') ? { referencePriceApplied: expected.referencePriceApplied } : {}),
      ...(Object.hasOwn(expected, 'referencePriceEligible') ? { referencePriceEligible: expected.referencePriceEligible } : {}),
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return false;
    const candidatesAt = (at: Date) => actual.candidates
      .filter((candidate) => candidate.promotion.status === 'active'
        && new Date(candidate.promotion.startsAt) <= at
        && new Date(candidate.promotion.endsAt) > at);
    const activeAtPricing = candidatesAt(pricedAt);
    const activeAtTransaction = candidatesAt(transactionNow);
    if (JSON.stringify(activeAtPricing.map((candidate) => candidate.bindingId))
      !== JSON.stringify(activeAtTransaction.map((candidate) => candidate.bindingId))) return false;
    if (expected.identity.state === 'unknown') return false;
    if (expected.referencePricePromotionId !== actual.referencePricePromotionId) return false;
    if (expected.referencePriceApplied && (currentReferenceConfig === null || currentReferenceConfig === 'unknown'
      || expected.referencePricePromotionId !== currentReferenceConfig.promotionId
      || !activeAtPricing.some((candidate) => candidate.promotion.id === currentReferenceConfig.promotionId)
      || !activeAtTransaction.some((candidate) => candidate.promotion.id === currentReferenceConfig.promotionId))) return false;
    if (expected.identity.state === 'knownnone' && activeAtPricing.length > 0) return false;
    if (expected.identity.state === 'restricted') {
      const winnerId = expected.identity.promotionId;
      if (!activeAtPricing.some((candidate) => candidate.promotion.id === winnerId)) return false;
    }
  }
  return true;
}

/** Revalidate reference-price rows independently of coupon identity, including unknown coupon scopes. */
export async function revalidateReferencePriceEvidence(
  tx: Prisma.TransactionClient,
  evidence: CouponPromotionPricingEvidence[],
  transactionNow: Date,
): Promise<boolean> {
  const config = referencePricePromotionConfig();
  // With the opt-in disabled, retain the prior behavior: only rows already priced
  // from the target activity need revalidation (and will fail closed if config vanished).
  const applicable = config === null
    ? evidence.filter((entry) => entry.referencePriceApplied === true)
    : evidence.filter((entry) => entry.referencePriceEligible === true || entry.referencePriceApplied === true);
  if (applicable.length === 0) return true;
  if (!config || config === 'unknown') return false;
  for (const expected of applicable) {
    if ((expected.referencePriceScope ?? null) !== (config.scope ? JSON.stringify(config.scope) : null)) return false;
    if (expected.referencePricePromotionId !== config.promotionId) return false;
    if (expected.variantId !== null && (!config.scope || expected.productId !== config.scope.productId)) return false;
    const pricedAt = new Date(expected.pricedAt);
    if (!Number.isFinite(pricedAt.getTime())) return false;
    const product = await tx.product.findUnique({
      where: { id: expected.productId },
      select: { price: true, originalPrice: true, promotionalPrice: true, minimumSalePrice: true },
    });
    if (!product || JSON.stringify({
      price: product.price, originalPrice: product.originalPrice,
      promotionalPrice: product.promotionalPrice, minimumSalePrice: product.minimumSalePrice,
    }) !== JSON.stringify(expected.product)) return false;
    const variant = expected.variantId ? await tx.productVariant.findUnique({
      where: { id: expected.variantId },
      select: { productId: true, price: true, promotionalPrice: true, minimumSalePrice: true },
    }) : null;
    if (expected.variantId && (!variant || variant.productId !== expected.productId
      || JSON.stringify({ price: variant.price, promotionalPrice: variant.promotionalPrice, minimumSalePrice: variant.minimumSalePrice }) !== JSON.stringify(expected.variant))) return false;
    const bindings = await tx.promotionProduct.findMany({
      where: expected.variantId ? { productId: expected.productId, OR: [{ variantId: null }, { variantId: expected.variantId }] }
        : { productId: expected.productId, variantId: null },
      select: {
        id: true, productId: true, variantId: true, groupKey: true,
        promotion: { select: {
          id: true, type: true, value: true, ruleDefinition: true, ruleVersion: true,
          status: true, startsAt: true, endsAt: true, priority: true, exclusive: true,
        } },
      },
    });
    const candidates = bindings.map((link) => ({
      bindingId: link.id, productId: link.productId, variantId: link.variantId, groupKey: link.groupKey,
      promotion: { ...link.promotion, startsAt: link.promotion.startsAt.toISOString(), endsAt: link.promotion.endsAt.toISOString() },
    })).sort((a, b) => a.bindingId.localeCompare(b.bindingId));
    if (JSON.stringify(candidates) !== JSON.stringify(expected.candidates)) return false;
    const activeBindingIdsAt = (at: Date) => candidates
      .filter((candidate) => candidate.promotion.status === 'active'
        && new Date(candidate.promotion.startsAt) <= at
        && new Date(candidate.promotion.endsAt) > at)
      .map((candidate) => candidate.bindingId);
    if (JSON.stringify(activeBindingIdsAt(pricedAt)) !== JSON.stringify(activeBindingIdsAt(transactionNow))) return false;
    const target = candidates.filter((candidate) => candidate.promotion.id === config.promotionId);
    const activeTargetsAt = (at: Date) => target.filter((candidate) => candidate.promotion.status === 'active'
      && new Date(candidate.promotion.startsAt) <= at && new Date(candidate.promotion.endsAt) > at);
    const appliesAt = (at: Date) => {
      const activeTargets = activeTargetsAt(at);
      return expected.variantId === null && activeTargets.length === 1
        && activeTargets[0].variantId === null
        && activeTargets[0].promotion.type === 'discount_rate'
        && activeTargets[0].promotion.ruleDefinition === null
        && Number.isFinite(activeTargets[0].promotion.value)
        && activeTargets[0].promotion.value > 0 && activeTargets[0].promotion.value <= 1
        && typeof product.originalPrice === 'number' && product.originalPrice > 0;
    };
    // A target activity that is active but invalid would make checkout reject during
    // pricing; reject the transaction if it became invalid after the pricing snapshot.
    if ((activeTargetsAt(pricedAt).length > 0 && !appliesAt(pricedAt))
      || (activeTargetsAt(transactionNow).length > 0 && !appliesAt(transactionNow))) return false;
    const scope = config.scope;
    if (scope && target.some((candidate) => expected.productId !== scope.productId || candidate.variantId !== null
      || candidate.promotion.value !== scope.rate
      || candidate.promotion.startsAt !== scope.startsAt || candidate.promotion.endsAt !== scope.endsAt)) return false;
    if (scope && expected.productId === scope.productId && ((pricedAt >= new Date(scope.startsAt) && pricedAt < new Date(scope.endsAt))
      || (transactionNow >= new Date(scope.startsAt) && transactionNow < new Date(scope.endsAt))) && target.length !== 1) return false;
    const expectedApplied = expected.referencePriceApplied === true;
    if (appliesAt(pricedAt) !== expectedApplied || appliesAt(transactionNow) !== expectedApplied) return false;
  }
  return true;
}

const pricingProductSelect = {
  id: true,
  catalogNumber: true,
  price: true,
  originalPrice: true,
  promotionalPrice: true,
  pricingMode: true,
  name: true,
  brand: true,
  subBrand: true,
  minimumSalePrice: true,
  hazardous: true,
  category: true,
  subcategory: true,
  deletedAt: true,
  inStock: true,
  leadTime: true,
  stockQuantity: true,
  promotionLinks: { include: { promotion: true } },
} satisfies Prisma.ProductSelect;

type PricingProduct = Prisma.ProductGetPayload<{ select: typeof pricingProductSelect }>;

async function findProductByCatalogNumber(catalogNumber: string, brand?: string | null): Promise<PricingProduct | null> {
  const where = {
    catalogNumber,
    ...(brand ? { brand } : {}),
  };

  const products = await prisma.product.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    take: brand ? 1 : 2,
    select: pricingProductSelect,
  });

  if (!brand && products.length > 1) {
    throw new Error(AMBIGUOUS_PRODUCT_CATALOG_NUMBER);
  }

  return products[0] ?? null;
}

async function findPricingProduct(item: PriceLookupItem): Promise<PricingProduct | null> {
  if (item.productId) {
    const productById = await prisma.product.findUnique({
      where: { id: item.productId },
      select: pricingProductSelect,
    }).catch(() => null);

    if (productById) return productById;
  }

  const catalogNumber = item.catalogNumber || item.productId;
  if (!catalogNumber) return null;

  return findProductByCatalogNumber(catalogNumber, item.brand);
}

function explicitBrandDiscount(value: string | null | undefined, brand: string, subBrand?: string | null): number | null {
  if (!value) return null;
  try {
    const discounts = JSON.parse(value) as Record<string, number>;
    const rate = lookupBrandDiscountRate(discounts, brand, subBrand);
    return typeof rate === 'number' && rate > 0 && rate <= 1 ? rate : null;
  } catch {
    return null;
  }
}

/**
 * Verify and recompute item prices server-side.
 *
 * Strategy:
 *  1. Look up each item in the Product table by catalogNumber / productId
 *  2. Use DB price (preferring promotionalPrice when product.promotion is true)
 *  3. If product not in DB or price is 0, fall back to the client-supplied price
 *     (mark `priceMismatch: true` so admin can review)
 *  4. Compute line totals and the grand total
 *
 * Returns the verified items and the recomputed subtotal. The caller MUST
 * persist `verifiedSubtotal`, not the client-submitted `subtotal`.
 */
export async function verifyAndPriceItems(
  items: PriceLookupItem[],
  context: PricingContext = {},
): Promise<{ verifiedItems: VerifiedItem[]; verifiedSubtotal: number; mismatchedCount: number }> {
  const verifiedItems: VerifiedItem[] = [];
  let verifiedSubtotal = 0;
  let mismatchedCount = 0;
  const now = context.now || new Date();
  const user = context.userId || context.customerEmail
    ? await prisma.user.findFirst({
      where: context.userId ? { id: context.userId } : { email: context.customerEmail! },
      select: { tier: true, discountRate: true, brandDiscounts: true, isFrozen: true },
    })
    : null;
  const allowMemberDiscount = Boolean(user && !user.isFrozen);

  for (const item of items) {
    if (context.strictQuantity && (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || !Number.isInteger(item.quantity) || item.quantity <= 0)) {
      throw new Error('INVALID_QUANTITY');
    }
    const qty = context.strictQuantity ? item.quantity as number : (item.quantity && item.quantity > 0 ? item.quantity : 1);
    const lookupKey = item.catalogNumber || item.productId || item.variantId;

    let unitPrice: number | null = null;
    let matchedCatalog: string | null = null;
    let matchedProductId: string | null = null;
    let matchedBrand: string | null = null;
    let source: 'db' | 'fallback' = 'fallback';
    let quoteRequired = false;
    let referencePriceEligible = false;
    let available: boolean | null = null;
    let leadTime: string | null = null;
    let stockQuantity: number | null = null;
    let matchedVariantId: string | null = null;
    let baseUnitPrice: number | undefined;
    let matchedSpec: string | null = null;
    let matchedCategory: string | null = null;
    let matchedSubcategory: string | null = null;
    let matchedDelisted = false;
    let selectedPromotionId: string | null = null;
    let promotionIdentity: import('@/lib/coupon-scope').CouponPromotionIdentity = { state: 'unknown' };
    let promotionEvidence: CouponPromotionPricingEvidence | undefined;
    let manualAdjustment: PriceAdjustment | undefined;
    let pricingSnapshot = '';

    if (lookupKey) {
      const directProduct = item.variantId ? null : await findPricingProduct(item);
      const variant = item.variantId
        ? await prisma.productVariant.findUnique({ where: { id: item.variantId }, select: pricingVariantSelect }).catch(() => null)
        : directProduct ? null : await prisma.productVariant.findFirst({ where: { catalogNumber: lookupKey }, select: pricingVariantSelect }).catch(() => null);
      if (item.variantId && !variant) throw new Error('PRODUCT_VARIANT_NOT_FOUND');
      const product = directProduct || await prisma.product.findFirst({
        where: variant
          ? { id: variant.productId }
          : { id: lookupKey },
        orderBy: { createdAt: 'asc' },
        select: pricingProductSelect,
      }).catch(() => null);
      if (product && variant) {
        if (variant.productId !== product.id) throw new Error('PRODUCT_VARIANT_MISMATCH');
        if (item.productId && item.productId !== product.id) throw new Error('PRODUCT_VARIANT_MISMATCH');
        if (item.catalogNumber && item.catalogNumber !== variant.catalogNumber) throw new Error('PRODUCT_CATALOG_MISMATCH');
      } else if (product && item.catalogNumber && item.catalogNumber !== product.catalogNumber) {
        throw new Error('PRODUCT_CATALOG_MISMATCH');
      }
      if (product && item.brand && item.brand !== product.brand) throw new Error('PRODUCT_BRAND_MISMATCH');
      if (product) {
        available = product.inStock;
        leadTime = product.leadTime;
        // 规格已有库存账户时，可售量以该账户为准（-1 仍是不限库存）。没有规格账户才用商品 stockQuantity。
        // 货期/leadTime 只是快照，不作为期货或超卖开关。
        const variantAvailable = variant?.inventoryAccounts?.[0]?.availableQuantity;
        stockQuantity = variantAvailable ?? product.stockQuantity;
        matchedVariantId = variant?.id || null;
        matchedSpec = variant?.spec ?? item.spec ?? null;
        matchedCategory = product.category;
        matchedSubcategory = product.subcategory;
        matchedDelisted = product.deletedAt != null;
        promotionEvidence = promotionPricingEvidence(product, variant, now);
      }
      const adjustmentKey = variant?.id || variant?.catalogNumber || product?.catalogNumber || item.catalogNumber || item.productId || undefined;
      manualAdjustment = adjustmentKey
        ? context.manualAdjustments?.[adjustmentKey]
          ?? (item.catalogNumber ? context.manualAdjustments?.[item.catalogNumber] : undefined)
          ?? (item.productId ? context.manualAdjustments?.[item.productId] : undefined)
        : undefined;
      if (product?.pricingMode === 'inquiry' && !(manualAdjustment && context.allowManualAdjustment)) {
        if (!context.allowQuoteRequired) throw new Error('PRODUCT_REQUIRES_INQUIRY');
        quoteRequired = true;
        pricingSnapshot = JSON.stringify({
          calculatedAt: now.toISOString(), productId: product.id, variantId: variant?.id || null,
          catalogNumber: variant?.catalogNumber || product.catalogNumber,
          status: 'quote_required', available, leadTime, stockQuantity,
        });
      }
      if (product?.hazardous && !context.allowHazardousProducts) {
        throw new CustomerUnavailableProductError(product.catalogNumber, product.name);
      }
      const activePromotionLinks = product?.promotionLinks
          .filter((link) => (!link.variantId || link.variantId === variant?.id)
            && link.promotion.status === 'active'
            && link.promotion.startsAt <= now && link.promotion.endsAt > now) ?? [];
      const referenceConfig = referencePricePromotionConfig();
      const configuredReferenceLinks = referenceConfig && referenceConfig !== 'unknown'
        ? activePromotionLinks.filter((link) => link.promotion.id === referenceConfig.promotionId)
        : [];
      const configuredReferenceLink = configuredReferenceLinks.length === 1 ? configuredReferenceLinks[0] : undefined;
      const scope = referenceConfig && referenceConfig !== 'unknown' ? referenceConfig.scope : undefined;
      if (scope && configuredReferenceLinks.some((link) => product?.id !== scope.productId || link.variantId !== null
        || link.promotion.value !== scope.rate || link.promotion.startsAt.toISOString() !== scope.startsAt
        || link.promotion.endsAt.toISOString() !== scope.endsAt)) throw new Error('REFERENCE_PRICE_PROMOTION_INVALID');
      if (scope && product?.id === scope.productId && !item.promoMark && !quoteRequired
        && now >= new Date(scope.startsAt) && now < new Date(scope.endsAt)
        && (variant || configuredReferenceLinks.length !== 1)) throw new Error('REFERENCE_PRICE_PROMOTION_INVALID');
      if (product && variant && !item.promoMark && configuredReferenceLinks.length > 0) {
        throw new Error('REFERENCE_PRICE_PROMOTION_INVALID');
      }
      const inReferenceScope = Boolean(product && !variant && !item.promoMark && !quoteRequired);
      referencePriceEligible = inReferenceScope || Boolean(scope && product?.id === scope.productId && variant && !item.promoMark && !quoteRequired);
      const referenceReady = Boolean(product && variant == null && configuredReferenceLinks.length === 1
          && configuredReferenceLink !== undefined && configuredReferenceLink.variantId == null && configuredReferenceLink.promotion.ruleDefinition == null
          && configuredReferenceLink.promotion.type === 'discount_rate'
          && Number.isFinite(configuredReferenceLink.promotion.value)
          && configuredReferenceLink.promotion.value > 0 && configuredReferenceLink.promotion.value <= 1
          && typeof product.originalPrice === 'number' && Number.isFinite(product.originalPrice) && product.originalPrice > 0);
      if (inReferenceScope && configuredReferenceLinks.length > 0 && !referenceReady) {
        throw new Error('REFERENCE_PRICE_PROMOTION_INVALID');
      }
      const referenceApplies = inReferenceScope && referenceReady;
      if (promotionEvidence) {
        promotionEvidence = { ...promotionEvidence, referencePriceApplied: referenceApplies, referencePriceEligible };
      }
      if (!quoteRequired && product && (referenceApplies || product.price > 0 || (variant?.price || 0) > 0)) {
        const activeDatabasePromotionIds = new Set(activePromotionLinks.map((link) => link.promotion.id));
        const promotions: PromotionCandidate[] = activePromotionLinks.map((link) => ({
            id: link.promotion.id,
            name: link.promotion.name,
            type: referenceApplies && link === configuredReferenceLink ? 'fixed_price' : link.promotion.type as PromotionCandidate['type'],
            value: referenceApplies && link === configuredReferenceLink
              ? Math.round((product.originalPrice! * link.promotion.value + Number.EPSILON) * 100) / 100
              : link.promotion.value,
            priority: link.promotion.priority,
            exclusive: link.promotion.exclusive,
          }));
        const syntheticPromotionIds = new Set<string>();
        // P0-1 统一前后台价格源：前台 getEffectiveProductPrice 用 promotionalPrice（>0 即生效），
        // 服务端同样将其纳入促销候选（fixed_price），与会员/品牌折扣、Promotion 表促销统一「取最低成交价」。
        if (!referenceApplies && product.promotionalPrice != null && product.promotionalPrice > 0) {
          syntheticPromotionIds.add('product-promotional-price');
          promotions.push({
            id: 'product-promotional-price',
            name: '商品促销价',
            type: 'fixed_price',
            value: product.promotionalPrice,
            priority: 0,
            exclusive: true,
          });
        }
        if (variant?.promotionalPrice != null && variant.promotionalPrice > 0) {
          syntheticPromotionIds.add(`variant-promotional-price:${variant.id}`);
          promotions.push({
            id: `variant-promotional-price:${variant.id}`,
            name: '规格促销价',
            type: 'fixed_price',
            value: variant.promotionalPrice,
            priority: 0,
            exclusive: true,
          });
        }
        if (manualAdjustment && !context.allowManualAdjustment) throw new Error('MANUAL_PRICE_ADJUSTMENT_FORBIDDEN');
        // 促销标记行（换购/赠品）：按原价计价，不叠加会员/品牌折扣与促销价（优惠由下单 API 统一扣减）
        const isPromoLine = Boolean(item.promoMark);
        const result = calculatePrice({
          basePrice: referenceApplies ? product.originalPrice! : product.price,
          variantPrice: referenceApplies ? null : variant?.price,
          tier: !isPromoLine && allowMemberDiscount ? user?.tier : undefined,
          personalDiscountRate: !isPromoLine && allowMemberDiscount ? user?.discountRate : null,
          brandDiscountRate: !isPromoLine && allowMemberDiscount
            ? explicitBrandDiscount(user?.brandDiscounts, product.brand, product.subBrand)
            : null,
          promotions: isPromoLine ? [] : promotions,
          manualAdjustment: isPromoLine ? null : manualAdjustment,
          minimumSalePrice: isPromoLine ? undefined : (variant?.minimumSalePrice ?? product.minimumSalePrice),
        });
        // Promotion identity is trusted only when the exact server-loaded Promotion
        // candidate won pricing and no later override changed its effective price.
        const appliedPromotionId = result.appliedSource.startsWith('promotion:')
          ? result.appliedSource.slice('promotion:'.length)
          : '';
        if (appliedPromotionId && !result.minimumPriceApplied && !manualAdjustment
          && activeDatabasePromotionIds.has(appliedPromotionId)
          && !syntheticPromotionIds.has(appliedPromotionId)) {
          selectedPromotionId = appliedPromotionId;
        }
        promotionIdentity = referenceConfig === 'unknown' ? { state: 'unknown' } : selectedPromotionId
          ? { state: 'restricted', promotionId: selectedPromotionId }
          : activePromotionLinks.length === 0 && syntheticPromotionIds.size === 0
            && !manualAdjustment && !result.minimumPriceApplied
            ? { state: 'knownnone' }
            : { state: 'unknown' };
        if (promotionEvidence) promotionEvidence = { ...promotionEvidence, identity: promotionIdentity };
        unitPrice = result.finalPrice;
        matchedCatalog = variant?.catalogNumber || product.catalogNumber;
        matchedProductId = product.id;
        matchedBrand = product.brand;
        pricingSnapshot = JSON.stringify({
          calculatedAt: now.toISOString(), productId: product.id, variantId: variant?.id || null,
          catalogNumber: matchedCatalog, ...result, referencePriceApplied: referenceApplies,
          couponPromotionIdentity: promotionIdentity,
          couponPromotionPricingEvidence: promotionEvidence,
        });
        source = 'db';
      }
    }

    if (unitPrice == null && manualAdjustment && context.allowManualAdjustment) {
      unitPrice = manualAdjustment.value;
      source = 'db';
      pricingSnapshot = JSON.stringify({ calculatedAt: now.toISOString(), finalPrice: unitPrice, appliedSource: 'admin_manual_quote' });
    }
    if (unitPrice == null) {
      if (context.allowQuoteRequired) {
        quoteRequired = true;
        unitPrice = 0;
        pricingSnapshot ||= JSON.stringify({
          calculatedAt: now.toISOString(), status: 'quote_required', available, leadTime, stockQuantity,
          clientReferencePrice: Number.isFinite(item.price) && item.price >= 0 ? item.price : null,
        });
      } else {
        if (context.allowClientFallback === false) throw new Error('CLIENT_FALLBACK_FORBIDDEN');
        if (!Number.isFinite(item.price) || item.price < 0) throw new Error('INVALID_FALLBACK_PRICE');
        unitPrice = item.price;
        mismatchedCount++;
        pricingSnapshot = JSON.stringify({
          calculatedAt: now.toISOString(), finalPrice: unitPrice, currency: 'CNY', appliedSource: 'fallback',
          minimumPriceApplied: false, steps: [{ stage: 'base', source: 'client_fallback', before: unitPrice, after: unitPrice, applied: true, reason: '产品价格未匹配，等待管理员审核' }],
        });
      }
    }

    const lineTotal = unitPrice * qty;
    if (!quoteRequired) verifiedSubtotal += lineTotal;

    verifiedItems.push({
      productId: matchedProductId || item.productId || null,
      catalogNumber: matchedCatalog || item.catalogNumber || item.productId || null,
      brand: matchedBrand || item.brand || null,
      name: item.name,
    unitPrice,
    baseUnitPrice,
      quantity: qty,
      lineTotal,
      priceMismatch: source === 'fallback',
      clientPrice: source === 'fallback' ? item.price : undefined,
      source,
      quoteRequired,
      variantId: matchedVariantId,
      spec: matchedSpec ?? item.spec ?? null,
      unit: item.unit ?? null,
      category: matchedCategory,
      subcategory: matchedSubcategory,
      delisted: matchedDelisted,
      selectedPromotionId,
      promotionIdentity,
      promotionPricingEvidence: promotionEvidence,
      referencePriceApplied: promotionEvidence?.referencePriceApplied ?? false,
      referencePriceEligible,
      pricingAt: now.toISOString(),
      available,
      leadTime,
      stockQuantity,
      pricingSnapshot,
    });
  }

  return { verifiedItems, verifiedSubtotal, mismatchedCount };
}
