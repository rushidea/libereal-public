import { createHash } from 'node:crypto';
import { calculatePrice, type PromotionCandidate } from '@/lib/price-engine';
import { lookupBrandDiscountRate } from '@/lib/discount-brand-catalog';
import { parsePromotionDefinition, validatePromotionBindings, type PromotionSkuBinding } from '@/data/promotion-foundation';
import type { BoundPromotion } from '@/data/promotion-calculation';
import { calculateUnifiedPromotionPricing } from '@/lib/unified-promotion-pricing';
import type { CandidateCartLine } from '@/lib/promotion-candidate-enumerator';
import type { QualifiedPlanCandidate } from '@/lib/promotion-plan-solver';
import { buildUnifiedLegacyPromotionCandidates, type UnifiedLegacyRuleEvidence, type UnifiedLegacySourceLine } from '@/lib/cart-promotions/service';
import { legacyRuleCanonicalHash } from '@/lib/legacy-rule-version';
import { PROMOTION_RULES } from '@/lib/cart-promotions/rules';
import { isAddonProduct } from '@/lib/cart-promotions/matching';
import type { Prisma, PrismaClient } from '@prisma/client';

/** Real Prisma client or transaction client; callers can inject the same tx used by order writes. */
export type UnifiedPricingClient = PrismaClient | Prisma.TransactionClient;

const variantSourceSelect = {
  id: true, productId: true, catalogNumber: true, spec: true, price: true, originalPrice: true, promotionalPrice: true,
  minimumSalePrice: true, inventoryAccounts: { select: { availableQuantity: true }, take: 1 },
} as const satisfies Prisma.ProductVariantSelect;
const promotionLinkSourceSelect = {
  id: true, promotionId: true, productId: true, variantId: true, groupKey: true,
} as const satisfies Prisma.PromotionProductSelect;
const productSourceSelect = {
  id: true, catalogNumber: true, name: true, brand: true, subBrand: true, category: true, subcategory: true,
  deletedAt: true, pricingMode: true, inStock: true, stockQuantity: true, leadTime: true, hazardous: true,
  price: true, originalPrice: true, promotionalPrice: true, minimumSalePrice: true,
  variants: { select: variantSourceSelect }, promotionLinks: { select: promotionLinkSourceSelect },
} as const satisfies Prisma.ProductSelect;
type ProductSource = Prisma.ProductGetPayload<{ select: typeof productSourceSelect }>;
type VariantSource = ProductSource['variants'][number];
const promotionSourceSelect = {
  id: true, name: true, type: true, value: true, status: true, startsAt: true, endsAt: true,
  priority: true, exclusive: true, ruleDefinition: true, ruleVersion: true,
  products: { select: { id: true, productId: true, variantId: true, groupKey: true } },
} as const satisfies Prisma.PromotionSelect;
type PromotionSource = Prisma.PromotionGetPayload<{ select: typeof promotionSourceSelect }>;
function promotionBindings(rows: PromotionSource['products'], groupOverride?: string): PromotionSkuBinding[] {
  return rows.map((binding) => ({ productId: binding.productId, variantId: binding.variantId, groupKey: groupOverride ?? binding.groupKey }));
}

export type UnifiedPricingRequestLine = { productId?: string | null; catalogNumber?: string | null; variantId?: string | null; brand?: string | null; quantity: number;
  promoMark?: { ruleId: string; price?: number; choice?: string } | null };
export type UnifiedPricingIdentity = {
  id: string; productId: string; variantId: string | null; quantity: number;
  catalogNumber: string; name: string; brand: string; category: string | null; subcategory: string | null;
  deletedAt: string | null; pricingMode: string; available: boolean; stockQuantity: number | null; leadTime: string | null; spec: string | null;
  referencePriceApplied?: boolean;
};
type ResolvedSourceLine = { identity: UnifiedPricingIdentity; product: ProductSource; variant: VariantSource | null };
export type UnifiedPricingEvidence = {
  at: string;
  userId: string | null;
  referencePricePromotionId: string | null;
  items: UnifiedPricingIdentity[];
  products: Array<{ id: string; pricingMode: string; price: number | null; promotionalPrice: number | null; minimumSalePrice: number | null; originalPrice: number | null; brand: string; subBrand: string | null; variants: unknown[]; promotionLinks: unknown[] }>;
  user: unknown;
  promotions: Array<{ id: string; name: string; type: string; value: number; status: string; startsAt: string; endsAt: string; priority: number; exclusive: boolean; ruleDefinition: string | null; ruleVersion: number; bindings: Array<{ bindingId: string; productId: string; variantId: string | null; groupKey: string }> }>;
  campaigns: BoundPromotion[];
  legacyCartPromotions: Array<Omit<UnifiedLegacyRuleEvidence, 'canonicalConfig'> & { versionHash: string }>;
  legacyCartCandidates: QualifiedPlanCandidate[];
  legacyPromotions: Array<{ skuKey: string; id: string; type: string; value: number; priority: number; exclusive: boolean; status: string; startsAt: string; endsAt: string; version: number; bindings: Array<{ productId: string; variantId: string | null; groupKey: string }> }>;
  lines: CandidateCartLine[];
  ordinaryUnitPricesCents: Array<number | null>;
};
export type UnifiedPricingSnapshot = {
  items: UnifiedPricingIdentity[];
  evidence: UnifiedPricingEvidence;
  evidenceHash: string;
  pricing: ReturnType<typeof calculateUnifiedPromotionPricing>;
  unitPriceAllocations: Array<{ productId: string; variantId: string | null; quantity: number; ordinaryUnitPriceCents: number | null; reconstructable: boolean; priceBands: Array<{ quantity: number; unitPriceCents: number; promotionId: string | null; sourceLineId?: string }> | null }>;
};

function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

async function resolveSources(client: UnifiedPricingClient, lines: UnifiedPricingRequestLine[]): Promise<ResolvedSourceLine[]> {
  if (!Array.isArray(lines) || !lines.length || lines.length > 200) throw new Error('INVALID_UNIFIED_PRICING_REQUEST');
  const selectors = lines.map((line) => ({ ...line }));
  const ors: Prisma.ProductWhereInput[] = [];
  for (const line of selectors) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error('INVALID_QUANTITY');
    if (line.productId) ors.push({ id: line.productId });
    if (line.catalogNumber) {
      ors.push({ catalogNumber: line.catalogNumber });
      ors.push({ variants: { some: { catalogNumber: line.catalogNumber } } });
    }
    if (line.variantId) ors.push({ variants: { some: { id: line.variantId } } });
    if (!line.productId && !line.catalogNumber && !line.variantId) throw new Error('INVALID_UNIFIED_PRICING_IDENTITY');
  }
  const variantIds = [...new Set(selectors.map((line) => line.variantId).filter((id): id is string => Boolean(id)))];
  const variantCatalogNumbers = [...new Set(selectors.filter((line) => line.variantId !== null)
    .map((line) => line.catalogNumber).filter((number): number is string => Boolean(number)))];
  const selectForVariants = (variantConditions: Prisma.ProductVariantWhereInput[]) => ({
    ...productSourceSelect,
    variants: { where: variantConditions.length ? { OR: variantConditions } : { id: { in: [] } }, take: 201, select: variantSourceSelect },
    promotionLinks: { take: 2001, select: promotionLinkSourceSelect },
  });
  let products = await client.product.findMany({ where: { OR: ors }, take: 201,
    select: selectForVariants([...(variantIds.length ? [{ id: { in: variantIds } }] : []), ...(variantCatalogNumbers.length ? [{ catalogNumber: { in: variantCatalogNumbers } }] : [])]) });
  const fallbackNumbers = [...new Set(selectors.filter((line) => line.productId && !line.catalogNumber && !products.some((product) => product.id === line.productId))
    .map((line) => line.productId!))];
  if (fallbackNumbers.length) {
    const fallbackRows = await client.product.findMany({ where: { OR: [
      { catalogNumber: { in: fallbackNumbers } }, { variants: { some: { catalogNumber: { in: fallbackNumbers } } } },
    ] }, take: 201, select: selectForVariants([...(variantIds.length ? [{ id: { in: variantIds } }] : []), { catalogNumber: { in: fallbackNumbers } }]) });
    products = [...new Map([...products, ...fallbackRows].map((product) => [product.id, product])).values()];
  }
  if (products.length > 200 || products.some((product) => (product.variants ?? []).length > 200)) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  if (products.some((product) => (product.promotionLinks ?? []).length > 2000)) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  const resolved = selectors.map((input) => {
    let candidates: Array<{ product: ProductSource; variant: VariantSource | null }> = [];
    if (input.variantId) {
      candidates = products.flatMap((product) => product.variants.filter((variant) => variant.id === input.variantId).map((variant) => ({ product, variant })));
    } else if (input.productId) {
      const product = products.find((row) => row.id === input.productId);
      if (product) {
        // Match legacy pricing semantics: a productId without a non-null variantId addresses the product row.
        candidates = [{ product, variant: null }];
      } else {
        const fallbackCatalogNumber = input.catalogNumber ?? input.productId;
        const productMatches = products.filter((row) => row.catalogNumber === fallbackCatalogNumber);
        candidates = productMatches.length ? productMatches.map((product) => ({ product, variant: null }))
          : products.flatMap((row) => input.variantId === null ? [] : row.variants.filter((variant) => variant.catalogNumber === fallbackCatalogNumber).map((variant) => ({ product: row, variant })));
      }
    } else if (input.catalogNumber) {
      candidates = products.flatMap((product) => [
        ...(product.catalogNumber === input.catalogNumber ? [{ product, variant: null }] : []),
        ...(input.variantId === null ? [] : product.variants.filter((variant) => variant.catalogNumber === input.catalogNumber).map((variant) => ({ product, variant }))),
      ]);
    }
    const directProduct = input.productId ? products.find((row) => row.id === input.productId) : null;
    if (input.productId && directProduct) candidates = candidates.filter(({ product }) => product.id === input.productId);
    const expectedCatalogNumber = input.catalogNumber ?? (input.productId && !directProduct ? input.productId : null);
    if (expectedCatalogNumber) candidates = candidates.filter(({ product, variant }) => (variant?.catalogNumber ?? product.catalogNumber) === expectedCatalogNumber);
    if (input.brand) candidates = candidates.filter(({ product }) => product.brand === input.brand);
    const unique = new Map(candidates.map((candidate) => [JSON.stringify([candidate.product.id, candidate.variant?.id ?? null]), candidate]));
    const matches = [...unique.values()];
    if (!matches.length) {
      const directProduct = input.productId ? products.find((row) => row.id === input.productId) : null;
      if (directProduct && input.catalogNumber && directProduct.catalogNumber !== input.catalogNumber) throw new Error('PRODUCT_CATALOG_MISMATCH');
      if (input.brand) {
        const withoutBrand = products.some((product) => {
          if (input.productId && product.id !== input.productId) return false;
          if (input.variantId) return product.variants.some((variant) => variant.id === input.variantId
            && (!input.catalogNumber || variant.catalogNumber === input.catalogNumber));
          if (!input.catalogNumber) return true;
          return product.catalogNumber === input.catalogNumber || product.variants.some((variant) => variant.catalogNumber === input.catalogNumber);
        });
        if (withoutBrand) throw new Error('PRODUCT_BRAND_MISMATCH');
      }
      if (input.variantId && input.productId && products.some((product) => product.id === input.productId)) throw new Error('PRODUCT_VARIANT_MISMATCH');
      if (input.variantId) throw new Error('PRODUCT_VARIANT_NOT_FOUND');
      if (input.productId) throw new Error('UNIFIED_PRICING_PRODUCT_NOT_FOUND');
      throw new Error('UNIFIED_PRICING_PRODUCT_NOT_FOUND');
    }
    if (matches.length > 1) throw new Error('AMBIGUOUS_PRODUCT_CATALOG_NUMBER');
    const { product, variant } = matches[0];
    if (input.variantId && (!variant || variant.productId !== product.id)) throw new Error('PRODUCT_VARIANT_MISMATCH');
    if (product.hazardous) throw new Error('HAZARDOUS_PRODUCT_UNAVAILABLE');
    const stockQuantity = variant?.inventoryAccounts?.[0]?.availableQuantity ?? product.stockQuantity ?? null;
    const identity: UnifiedPricingIdentity = { id: JSON.stringify([product.id, variant?.id ?? null]), productId: product.id, variantId: variant?.id ?? null,
      quantity: input.quantity, catalogNumber: variant?.catalogNumber ?? product.catalogNumber, name: product.name, brand: product.brand,
      category: product.category ?? null, subcategory: product.subcategory ?? null, deletedAt: product.deletedAt instanceof Date ? product.deletedAt.toISOString() : product.deletedAt ?? null,
      pricingMode: product.pricingMode, available: product.inStock, stockQuantity, leadTime: product.leadTime ?? null, spec: variant?.spec ?? null };
    return { identity, product, variant };
  });
  return resolved;
}

/** Resolve client-supplied SKU selectors to transaction-read identity and safety metadata. */
export async function resolveUnifiedPricingIdentities(client: UnifiedPricingClient, request: { lines: UnifiedPricingRequestLine[] }): Promise<{ items: UnifiedPricingIdentity[] }> {
  return { items: (await resolveSources(client, request.lines)).map(({ identity }) => identity) };
}
function validPrice(n: unknown): n is number { return typeof n === 'number' && Number.isFinite(n) && n > 0; }
function cents(n: number): number { const result = Math.round((n + Number.EPSILON) * 100); if (!Number.isSafeInteger(result) || result <= 0) throw new Error('INVALID_PROMOTION_PLAN_CART'); return result; }
function promotionStatus(value: unknown): BoundPromotion['status'] {
  if (value !== 'draft' && value !== 'active' && value !== 'paused' && value !== 'ended') throw new Error('UNIFIED_PRICING_PROMOTION_INCOMPLETE');
  return value;
}
function referencePricePromotionId(): string | null {
  const raw = process.env.REFERENCE_PRICE_PROMOTION_CONFIG;
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const config = value as Record<string, unknown>;
    if (Object.keys(config).length !== 1 || typeof config.promotionId !== 'string' || !config.promotionId.trim()) throw new Error();
    return config.promotionId.trim();
  } catch { throw new Error('UNIFIED_REFERENCE_PRICE_CONFIG_INVALID'); }
}
function exactDecimalScale(value: number, places: number): number | null {
  if (!Number.isFinite(value)) return null;
  const [mantissa, exponentText = '0'] = value.toString().toLowerCase().split('e');
  const exponent = Number(exponentText);
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const decimalPlaces = unsigned.split('.')[1]?.length ?? 0;
  const digitsText = unsigned.replace('.', '');
  let digits = BigInt(digitsText || '0');
  const power = exponent - decimalPlaces + places;
  if (power >= 0) digits *= BigInt(10) ** BigInt(power);
  else {
    const divisor = BigInt(10) ** BigInt(-power);
    if (digits % divisor !== BigInt(0)) return null;
    digits /= divisor;
  }
  if (negative) digits = -digits;
  const result = Number(digits);
  return Number.isSafeInteger(result) ? result : null;
}
function legacyDefinition(type: string, value: number): BoundPromotion['definition'] {
  let benefit: BoundPromotion['definition']['benefit'];
  const fixedCents = exactDecimalScale(value, 2);
  const rateBasisPoints = exactDecimalScale(value, 4);
  if (type === 'fixed_price' && validPrice(value) && fixedCents != null && fixedCents > 0) benefit = { kind: 'fixed-price', unitPriceCents: fixedCents };
  else if (type === 'discount_rate' && value > 0 && value <= 1 && rateBasisPoints != null) benefit = { kind: 'percentage', basisPoints: rateBasisPoints };
  else if (type === 'amount_off' && Number.isFinite(value) && value >= 0 && fixedCents != null) benefit = { kind: 'amount-off', amountCents: fixedCents };
  else throw new Error('UNIFIED_PRICING_LEGACY_PROMOTION_UNSUPPORTED');
  return parsePromotionDefinition({ schemaVersion: 1, template: 'direct-price', groups: [{ key: 'benefit', role: 'benefit', unit: 'each', quantity: 1 }], benefit,
    repeat: true, partialBenefit: false, maxApplications: null });
}

/**
 * Loads the complete product/variant, user pricing profile and promotion binding graph
 * through the injected client (pass a Prisma transaction client when snapshotting in a transaction).
 * No request-supplied price or variant inheritance is accepted.
 */
export async function createUnifiedPricingSnapshot(client: UnifiedPricingClient, request: {
  lines: UnifiedPricingRequestLine[]; userId?: string | null; now?: Date;
  /** Server-loaded candidate only; never populate this from an HTTP payload. */
  previewCampaign?: BoundPromotion;
}): Promise<UnifiedPricingSnapshot> {
  const now = request.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_UNIFIED_PRICING_REQUEST');
  const resolvedSources = await resolveSources(client, request.lines);
  const requestedQuantityBySku = new Map<string, number>();
  for (const { identity } of resolvedSources) {
    const next = (requestedQuantityBySku.get(identity.id) ?? 0) + identity.quantity;
    if (!Number.isSafeInteger(next)) throw new Error('INVALID_PROMOTION_AMOUNT');
    requestedQuantityBySku.set(identity.id, next);
  }
  const products = [...new Map(resolvedSources.map(({ product }) => [product.id, product])).values()];
  const [user] = await Promise.all([
    request.userId ? client.user.findUnique({ where: { id: request.userId }, select: { tier: true, discountRate: true, brandDiscounts: true, isFrozen: true } }) : Promise.resolve(null),
  ]);
  if (request.userId && !user) throw new Error('UNIFIED_PRICING_USER_NOT_FOUND');
  const promotionIds = [...new Set(products.flatMap((p) => p.promotionLinks.map((link) => link.promotionId)))];
  const promotionRows = promotionIds.length ? await client.promotion.findMany({ where: { id: { in: promotionIds } }, take: 201,
    select: { ...promotionSourceSelect, products: { take: 2001, select: promotionSourceSelect.products.select } } }) : [];
  if (promotionRows.length > 200 || promotionRows.some((promotion) => promotion.products.length > 2000)) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  const promotionById = new Map(promotionRows.map((p) => [p.id, p]));
  const referencePromotionId = referencePricePromotionId();
  const bound = new Map<string, BoundPromotion>();
  const ordinaryUnitPricesCents: Array<number | null> = [];
  const legacyPromotions: UnifiedPricingEvidence['legacyPromotions'] = [];
  const lines: CandidateCartLine[] = request.lines.map((requested, index) => {
    const { identity, product, variant } = resolvedSources[index];
    const key = identity.id;
    if (product.pricingMode === 'inquiry') throw new Error('PRODUCT_REQUIRES_INQUIRY');
    const referenceLinks = referencePromotionId ? product.promotionLinks.filter((link) => link.promotionId === referencePromotionId
      && (link.variantId == null || link.variantId === (variant?.id ?? null))
      && promotionById.get(link.promotionId)?.status === 'active'
      && new Date(promotionById.get(link.promotionId)!.startsAt) <= now && new Date(promotionById.get(link.promotionId)!.endsAt) > now) : [];
    let referencePriceApplied = false;
    if (referenceLinks.length) {
      if (variant || referenceLinks.length !== 1) throw new Error('REFERENCE_PRICE_PROMOTION_INVALID');
      const referencePromotion = promotionById.get(referencePromotionId!);
      if (!referencePromotion || referenceLinks[0].variantId != null || referencePromotion.ruleDefinition != null
        || referencePromotion.type !== 'discount_rate' || !Number.isFinite(referencePromotion.value)
        || referencePromotion.value <= 0 || referencePromotion.value > 1 || !validPrice(product.originalPrice)) {
        throw new Error('REFERENCE_PRICE_PROMOTION_INVALID');
      }
      referencePriceApplied = true;
    }
    const basePrice = referencePriceApplied ? product.originalPrice : variant ? variant.price : product.price;
    const hasBasePrice = validPrice(basePrice);
    const promotions: PromotionCandidate[] = [];
    if (!referencePriceApplied && validPrice(product.promotionalPrice)) promotions.push({ id: 'product-promotional-price', name: '商品促销价', type: 'fixed_price', value: product.promotionalPrice, priority: 0, exclusive: true });
    if (variant && validPrice(variant.promotionalPrice)) promotions.push({ id: `variant-promotional-price:${variant.id}`, name: '规格促销价', type: 'fixed_price', value: variant.promotionalPrice, priority: 0, exclusive: true });
    const eligibleUser = user && !user.isFrozen;
    let brandRate: number | null = null;
    if (eligibleUser && user.brandDiscounts) {
      try { brandRate = lookupBrandDiscountRate(JSON.parse(user.brandDiscounts), product.brand, product.subBrand) ?? null; } catch { throw new Error('INVALID_USER_BRAND_DISCOUNTS'); }
    }
    const skuCampaigns: BoundPromotion[] = [];
    for (const link of product.promotionLinks) {
      const promotion = promotionById.get(link.promotionId);
      if (!promotion) throw new Error('UNIFIED_PRICING_PROMOTION_INCOMPLETE');
      const effective = promotion.status === 'active' && new Date(promotion.startsAt) <= now && new Date(promotion.endsAt) > now;
      const isLegacy = promotion.ruleDefinition == null;
      if ((link.variantId ?? null) !== (variant?.id ?? null) && !(isLegacy && link.variantId == null && variant != null)) continue;
      if (effective && referencePromotionId && promotion.id === referencePromotionId && variant) throw new Error('REFERENCE_PRICE_PROMOTION_INVALID');
      if (effective && isLegacy) {
        legacyPromotions.push({ skuKey: key, id: promotion.id, type: promotion.type, value: promotion.value, priority: promotion.priority, exclusive: promotion.exclusive,
          status: promotion.status, startsAt: new Date(promotion.startsAt).toISOString(), endsAt: new Date(promotion.endsAt).toISOString(), version: promotion.ruleVersion,
          bindings: promotionBindings(promotion.products).sort((a, b) => JSON.stringify([a.productId, a.variantId, a.groupKey]).localeCompare(JSON.stringify([b.productId, b.variantId, b.groupKey]))) });
        let campaign = bound.get(promotion.id);
        if (!campaign) {
          const bindings = promotionBindings(promotion.products, 'benefit');
          // Historical product-level bindings applied to every variant in checkout pricing.
          for (const cartLine of resolvedSources.map((source) => source.identity)) if (cartLine.variantId && bindings.some((binding) => binding.productId === cartLine.productId && binding.variantId === null)
            && !bindings.some((binding) => binding.productId === cartLine.productId && binding.variantId === cartLine.variantId)) {
            bindings.push({ productId: cartLine.productId, variantId: cartLine.variantId, groupKey: 'benefit' });
          }
          const legacyRule = referencePriceApplied && promotion.id === referencePromotionId
            ? legacyDefinition('discount_rate', promotion.value)
            : legacyDefinition(promotion.type, promotion.value);
          campaign = { id: promotion.id, name: promotion.name, status: promotionStatus(promotion.status), startsAt: new Date(promotion.startsAt), endsAt: new Date(promotion.endsAt), version: promotion.ruleVersion,
            priority: promotion.priority, exclusive: promotion.exclusive, definition: legacyRule, bindings };
          bound.set(promotion.id, campaign);
        }
        if (!campaign) throw new Error('UNIFIED_PRICING_PROMOTION_INCOMPLETE');
        skuCampaigns.push(campaign);
        continue;
      }
      if (promotion.ruleDefinition == null) continue;
      let campaign = bound.get(promotion.id);
      if (!campaign) {
        campaign = { id: promotion.id, name: promotion.name, status: promotionStatus(promotion.status), startsAt: new Date(promotion.startsAt), endsAt: new Date(promotion.endsAt), version: promotion.ruleVersion, priority: promotion.priority, exclusive: promotion.exclusive, definition: parsePromotionDefinition(JSON.parse(promotion.ruleDefinition)), bindings: promotionBindings(promotion.products) };
        bound.set(promotion.id, campaign);
      }
      if (!campaign) throw new Error('UNIFIED_PRICING_PROMOTION_INCOMPLETE');
      skuCampaigns.push(campaign);
    }
    const catalogReference = variant ? variant.originalPrice : product.originalPrice;
    // The minimum-price guard is inherited by variants in the existing
    // checkout; this is independent of the catalog reference price.
    const isPromoLine = Boolean(requested.promoMark);
    const minimumSalePrice = isPromoLine ? undefined : (variant?.minimumSalePrice ?? product.minimumSalePrice);
    if (!isPromoLine && skuCampaigns.some((campaign) => campaign.status === 'active' && campaign.startsAt <= now && campaign.endsAt > now && campaign.definition.priceBasis === 'catalog')
      && !validPrice(catalogReference)) throw new Error('PROMOTION_CATALOG_PRICE_REQUIRED');
    const catalogReferenceCents = catalogReference == null ? null : validPrice(catalogReference) ? cents(catalogReference) : null;
    const ordinary = hasBasePrice ? calculatePrice({ basePrice, tier: !isPromoLine && eligibleUser ? user.tier : undefined,
      personalDiscountRate: !isPromoLine && eligibleUser ? user.discountRate : null, brandDiscountRate: isPromoLine ? null : brandRate,
      promotions: isPromoLine ? [] : promotions, minimumSalePrice }).finalPrice : null;
    const ordinaryCents = ordinary == null ? null : cents(ordinary);
    ordinaryUnitPricesCents.push(ordinaryCents);
    if (referencePriceApplied) identity.referencePriceApplied = true;
    const legacyPromotionUnitPriceOverridesCents: Record<string, number> = {};
    if (referencePriceApplied && referencePromotionId) {
      const referencePromotion = promotionById.get(referencePromotionId);
      if (!referencePromotion || !validPrice(product.originalPrice)) throw new Error('REFERENCE_PRICE_PROMOTION_INVALID');
      const unitPriceCents = Math.round((product.originalPrice * referencePromotion.value + Number.EPSILON) * 100);
      if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0) throw new Error('REFERENCE_PRICE_PROMOTION_INVALID');
      legacyPromotionUnitPriceOverridesCents[referencePromotionId] = unitPriceCents;
    }
    return { id: key, sourceLineId: String(index), databasePromotionEligible: !isPromoLine,
      productId: product.id, variantId: variant?.id ?? null, quantity: requested.quantity, unitPriceCents: ordinaryCents,
      basePriceCents: hasBasePrice ? cents(basePrice) : null, ...(catalogReferenceCents === null ? {} : { catalogReferenceCents }),
      ...(validPrice(minimumSalePrice) ? { minimumUnitCents: cents(minimumSalePrice) } : {}),
      ...(Object.keys(legacyPromotionUnitPriceOverridesCents).length ? { legacyPromotionUnitPriceOverridesCents } : {}) };
  });
  const campaigns = [...bound.values()].filter((campaign) => campaign.status === 'active' && campaign.startsAt <= now && campaign.endsAt > now)
    .map((campaign) => ({ ...campaign, bindings: campaign.bindings.filter((binding, i, all) => all.findIndex((b) => b.productId === binding.productId && b.variantId === binding.variantId) === i) }));
  if (request.previewCampaign) {
    const candidate = request.previewCampaign;
    if (!candidate.id || !candidate.definition || !Array.isArray(candidate.bindings)) throw new Error('INVALID_PROMOTION_PREVIEW');
    const definition = parsePromotionDefinition(candidate.definition);
    validatePromotionBindings(definition, candidate.bindings);
    const cartKeys = new Set(lines.map((line) => JSON.stringify([line.productId, line.variantId])));
    if (candidate.bindings.some((binding) => cartKeys.has(JSON.stringify([binding.productId, binding.variantId])))) {
      campaigns.splice(0, campaigns.length, ...campaigns.filter((campaign) => campaign.id !== candidate.id));
      campaigns.push({ ...candidate, status: 'active', definition });
    }
  }
  // The evidence is a normalized, repeatable record of every value read and passed to the solver.
  const legacySourceLines: UnifiedLegacySourceLine[] = request.lines.map((requested, index) => {
    const identity = resolvedSources[index].identity;
    const ordinary = lines[index];
    return { id: String(index), productId: identity.productId, variantId: identity.variantId, quantity: identity.quantity,
      unitPriceCents: ordinary.unitPriceCents,
      product: { id: identity.productId, variantId: identity.variantId ?? undefined, brand: identity.brand,
        catalogNumber: identity.catalogNumber, name: identity.name, spec: identity.spec,
        price: ordinary.unitPriceCents === null ? null : ordinary.unitPriceCents / 100, serverVerified: true },
      isQuickOrder: false, promoMark: requested.promoMark ?? null };
  });
  const staticPromotionPlan = buildUnifiedLegacyPromotionCandidates(legacySourceLines, now);
  for (const candidate of staticPromotionPlan.candidates) {
    const addon = candidate.addonSelection;
    if (addon) {
      const rule = PROMOTION_RULES.find((entry) => entry.type === 'addon' && `legacy-cart:${entry.id}` === addon.ruleId);
      if (!rule || rule.type !== 'addon' || addon.ruleId !== candidate.promotionId) throw new Error('INVALID_PROMOTION_CANDIDATE');
      const selected = new Map<string, number>();
      for (const entry of addon.selections) {
        const source = legacySourceLines.find((line) => line.id === entry.sourceLineId);
        if (!source || source.productId !== entry.productId || source.variantId !== entry.variantId || !isAddonProduct(rule, source.product)
          || (source.promoMark && source.promoMark.ruleId !== rule.id)) throw new Error('INVALID_PROMOTION_CANDIDATE');
        const option = rule.addonOptions?.find((item) => item.catalogNumber === source.product.catalogNumber);
        const perSelection = option?.quantity ?? rule.addonQuantityPerTrigger ?? 1;
        if ((rule.addonOptions?.length && !option) || entry.perSelection !== perSelection
          || !Number.isSafeInteger(entry.quantity) || entry.quantity <= 0) throw new Error('INVALID_PROMOTION_CANDIDATE');
        const count = (selected.get(entry.sourceLineId) ?? 0) + entry.quantity;
        if (!Number.isSafeInteger(count) || count > source.quantity) throw new Error('INVALID_PROMOTION_CANDIDATE');
        selected.set(entry.sourceLineId, count);
      }
      if (candidate.sharedQuota && JSON.stringify(candidate.sharedQuota.selections) !== JSON.stringify(addon.selections)) throw new Error('INVALID_PROMOTION_CANDIDATE');
    }
    const witness = candidate.sharedQuota;
    if (!witness) continue;
    for (const entry of witness.baselineSelections) {
      const source = legacySourceLines.find((line) => line.id === entry.sourceLineId);
      if (!source || !source.promoMark || source.productId !== entry.productId || source.variantId !== entry.variantId
        || source.quantity !== entry.quantity) throw new Error('INVALID_PROMOTION_CANDIDATE');
    }
    const used = new Map<string, number>();
    for (const entry of [...witness.qualifiers, ...witness.selections]) {
      const source = legacySourceLines.find((line) => line.id === entry.sourceLineId);
      if (!source || source.productId !== entry.productId || source.variantId !== entry.variantId
        || ('brand' in entry && (source.product.brand !== entry.brand || source.product.catalogNumber !== entry.catalogNumber
          || source.product.name !== entry.name))) throw new Error('INVALID_PROMOTION_CANDIDATE');
      const next = (used.get(entry.sourceLineId) ?? 0) + entry.quantity;
      if (!Number.isSafeInteger(next) || next > source.quantity) throw new Error('INVALID_PROMOTION_CANDIDATE');
      used.set(entry.sourceLineId, next);
    }
  }
  // IDs come from different stores; an overlap would make a selected winner's
  // source ambiguous to the coupon policy and must not be guessed.
  const dbPromotionIds = new Set([...promotionRows.map((promotion) => promotion.id), ...campaigns.map((campaign) => campaign.id)]);
  if (staticPromotionPlan.evidence.some((rule) => dbPromotionIds.has(rule.id))) throw new Error('UNIFIED_PROMOTION_ID_COLLISION');
  const evidence: UnifiedPricingEvidence = { at: now.toISOString(), userId: request.userId ?? null, referencePricePromotionId: referencePromotionId,
    products: products.map((p) => ({ id: p.id, pricingMode: p.pricingMode, price: p.price, promotionalPrice: p.promotionalPrice, minimumSalePrice: p.minimumSalePrice, originalPrice: p.originalPrice, brand: p.brand, subBrand: p.subBrand,
      variants: p.variants.map((v) => ({ id: v.id, price: v.price, promotionalPrice: v.promotionalPrice, minimumSalePrice: v.minimumSalePrice, originalPrice: v.originalPrice })).sort((a, b) => a.id.localeCompare(b.id)),
      promotionLinks: p.promotionLinks.map((link) => ({ id: link.id, promotionId: link.promotionId, productId: link.productId, variantId: link.variantId, groupKey: link.groupKey }))
        .sort((a, b) => a.id.localeCompare(b.id)) })).sort((a, b) => a.id.localeCompare(b.id)),
    user: user ? { tier: user.tier, discountRate: user.discountRate, brandDiscounts: user.brandDiscounts, isFrozen: user.isFrozen } : null,
    items: resolvedSources.map(({ identity }) => identity),
    promotions: promotionRows.map((p) => ({ id: p.id, name: p.name, type: p.type, value: p.value, status: p.status,
      startsAt: new Date(p.startsAt).toISOString(), endsAt: new Date(p.endsAt).toISOString(), priority: p.priority, exclusive: p.exclusive,
      ruleDefinition: p.ruleDefinition, ruleVersion: p.ruleVersion,
      bindings: p.products.map((b) => ({ bindingId: b.id, productId: b.productId, variantId: b.variantId, groupKey: b.groupKey }))
        .sort((a, b) => JSON.stringify([a.productId, a.variantId, a.groupKey]).localeCompare(JSON.stringify([b.productId, b.variantId, b.groupKey]))) })).sort((a, b) => a.id.localeCompare(b.id)),
    campaigns: campaigns.sort((a, b) => a.id.localeCompare(b.id)),
    legacyCartPromotions: staticPromotionPlan.evidence.map(({ canonicalConfig, ...rule }) => ({ ...rule, versionHash: legacyRuleCanonicalHash(canonicalConfig) })),
    legacyCartCandidates: staticPromotionPlan.candidates,
    legacyPromotions: legacyPromotions.sort((a, b) => a.skuKey.localeCompare(b.skuKey) || a.id.localeCompare(b.id)),
    lines, ordinaryUnitPricesCents };
  const stableEvidence = Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== 'at'));
  const evidenceHash = createHash('sha256').update(canonical(stableEvidence)).digest('hex');
  const pricing = calculateUnifiedPromotionPricing(lines, campaigns, now, [], staticPromotionPlan.candidates);
  const bySku = new Map(lines.map((line) => [JSON.stringify([line.productId, line.variantId]), line]));
  const unitPriceAllocations = pricing.lines.map((line) => {
    const key = JSON.stringify([line.productId, line.variantId]);
    const source = bySku.get(key);
    if (!source) throw new Error('INVALID_PROMOTION_PLAN');
    const rawBands = line.priceBands ?? (source.unitPriceCents == null ? null : [{ unitCents: source.unitPriceCents, quantity: line.quantity, source: 'ordinary' as const }]);
    if (!rawBands) return { productId: line.productId, variantId: line.variantId, quantity: line.quantity,
      ordinaryUnitPriceCents: source.unitPriceCents, reconstructable: false, priceBands: null };
    const bands = rawBands.map((band) => ({ quantity: band.quantity, unitPriceCents: band.unitCents,
      promotionId: band.source === 'promotion' ? line.promotionId : null,
      ...('sourceLineId' in band && band.sourceLineId ? { sourceLineId: band.sourceLineId } : {}) }));
    const quantity = bands.reduce((sum, band) => sum + band.quantity, 0);
    const total = bands.reduce((sum, band) => sum + band.quantity * band.unitPriceCents, 0);
    if (quantity !== line.quantity || total !== line.totalAfterCents || bands.some((band) => !Number.isSafeInteger(band.quantity)
      || band.quantity <= 0 || !Number.isSafeInteger(band.unitPriceCents) || band.unitPriceCents < 0)) {
      return { productId: line.productId, variantId: line.variantId, quantity: line.quantity,
        ordinaryUnitPriceCents: source.unitPriceCents, reconstructable: false, priceBands: null };
    }
    return { productId: line.productId, variantId: line.variantId, quantity: line.quantity,
      ordinaryUnitPriceCents: source.unitPriceCents, reconstructable: true, priceBands: bands };
  });
  return { items: resolvedSources.map(({ identity }) => identity), evidence, evidenceHash, pricing, unitPriceAllocations };
}
