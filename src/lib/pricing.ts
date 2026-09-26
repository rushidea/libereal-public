import { prisma } from '@/lib/prisma';
import { calculatePrice, type PriceAdjustment, type PromotionCandidate } from '@/lib/price-engine';
import { lookupBrandDiscountRate } from '@/lib/discount-brand-catalog';
import type { Prisma } from '@prisma/client';

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
  promoMark?: { ruleId: string; price?: number } | null;
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
  available?: boolean | null;
  leadTime?: string | null;
  stockQuantity?: number | null;
  pricingSnapshot: string;
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

const pricingProductSelect = {
  id: true,
  catalogNumber: true,
  price: true,
  promotionalPrice: true,
  pricingMode: true,
  name: true,
  brand: true,
  subBrand: true,
  minimumSalePrice: true,
  hazardous: true,
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
    let available: boolean | null = null;
    let leadTime: string | null = null;
    let stockQuantity: number | null = null;
    let matchedVariantId: string | null = null;
    let baseUnitPrice: number | undefined;
    let matchedSpec: string | null = null;
    let manualAdjustment: PriceAdjustment | undefined;
    let pricingSnapshot = '';

    if (lookupKey) {
      const directProduct = item.variantId ? null : await findPricingProduct(item);
      const variant = item.variantId
        ? await prisma.productVariant.findUnique({ where: { id: item.variantId }, select: { id: true, catalogNumber: true, spec: true, price: true, promotionalPrice: true, minimumSalePrice: true, productId: true } }).catch(() => null)
        : directProduct ? null : await prisma.productVariant.findFirst({ where: { catalogNumber: lookupKey }, select: { id: true, catalogNumber: true, spec: true, price: true, promotionalPrice: true, minimumSalePrice: true, productId: true } }).catch(() => null);
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
        stockQuantity = product.stockQuantity;
        matchedVariantId = variant?.id || null;
        matchedSpec = variant?.spec ?? item.spec ?? null;
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
      if (!quoteRequired && product && (product.price > 0 || (variant?.price || 0) > 0)) {
        const promotions: PromotionCandidate[] = product.promotionLinks
          .filter((link) => (!link.variantId || link.variantId === variant?.id)
            && link.promotion.status === 'active'
            && link.promotion.startsAt <= now
            && link.promotion.endsAt >= now)
          .map((link) => ({
            id: link.promotion.id,
            name: link.promotion.name,
            type: link.promotion.type as PromotionCandidate['type'],
            value: link.promotion.value,
            priority: link.promotion.priority,
            exclusive: link.promotion.exclusive,
          }));
        // P0-1 统一前后台价格源：前台 getEffectiveProductPrice 用 promotionalPrice（>0 即生效），
        // 服务端同样将其纳入促销候选（fixed_price），与会员/品牌折扣、Promotion 表促销统一「取最低成交价」。
        if (product.promotionalPrice != null && product.promotionalPrice > 0) {
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
          basePrice: product.price,
          variantPrice: variant?.price,
          tier: !isPromoLine && allowMemberDiscount ? user?.tier : undefined,
          personalDiscountRate: !isPromoLine && allowMemberDiscount ? user?.discountRate : null,
          brandDiscountRate: !isPromoLine && allowMemberDiscount
            ? explicitBrandDiscount(user?.brandDiscounts, product.brand, product.subBrand)
            : null,
          promotions: isPromoLine ? [] : promotions,
          manualAdjustment: isPromoLine ? null : manualAdjustment,
          minimumSalePrice: isPromoLine ? undefined : (variant?.minimumSalePrice ?? product.minimumSalePrice),
        });
        unitPrice = result.finalPrice;
        matchedCatalog = variant?.catalogNumber || product.catalogNumber;
        matchedProductId = product.id;
        matchedBrand = product.brand;
        pricingSnapshot = JSON.stringify({
          calculatedAt: now.toISOString(), productId: product.id, variantId: variant?.id || null,
          catalogNumber: matchedCatalog, ...result,
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
      available,
      leadTime,
      stockQuantity,
      pricingSnapshot,
    });
  }

  return { verifiedItems, verifiedSubtotal, mismatchedCount };
}
