import { NextRequest, NextResponse } from 'next/server';
import { unifiedPromotionRuntimeEnabled } from '@/lib/unified-promotion-config';
import { calculateBoundPromotions, type BoundPromotion, type PromotionPricingLine } from '@/data/promotion-calculation';
import { parsePromotionDefinition, promotionSkuKey, validatePromotionBindings, type PromotionSkuBinding } from '@/data/promotion-foundation';
import { promotionError, withPromotionRepository, type ManagedPromotion } from '@/lib/promotion-repository';
import { createUnifiedPricingSnapshot } from '@/lib/unified-pricing-snapshot';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

type PreviewLine = { productId: string; variantId: string | null; quantity: number };
type PreviewSelector =
  | { productId: string; variantId: string | null; groupKey: string }
  | { productId: string; allVariants: true; groupKey: string };
type PreviewDependencies = { unifiedPreviewReady: boolean; client: typeof prisma };

function parsePreviewInput(body: unknown, allowed: Set<string>): PreviewLine[] {
  if (!Array.isArray(body) || body.length > 2000) throw new Error('INVALID_PROMOTION_INPUT');
  const quantities = new Map<string, PreviewLine>();
  for (const raw of body) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_PROMOTION_INPUT');
    const item = raw as Record<string, unknown>;
    if (typeof item.productId !== 'string' || !item.productId.trim()
      || !(item.variantId === null || (typeof item.variantId === 'string' && item.variantId.trim()))
      || !Number.isSafeInteger(item.quantity) || (item.quantity as number) < 0) throw new Error('INVALID_PROMOTION_INPUT');
    const line = { productId: item.productId, variantId: item.variantId as string | null, quantity: item.quantity as number };
    const key = promotionSkuKey(line);
    if (!allowed.has(key)) throw new Error('INVALID_PROMOTION_BINDING');
    if (line.quantity === 0) continue;
    const existing = quantities.get(key);
    const quantity = (existing?.quantity ?? 0) + line.quantity;
    if (!Number.isSafeInteger(quantity)) throw new Error('INVALID_PROMOTION_INPUT');
    quantities.set(key, { ...line, quantity });
  }
  const lines = [...quantities.values()];
  if (!lines.length) throw new Error('INVALID_PROMOTION_INPUT');
  if (lines.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  return lines;
}

function parseSelectors(raw: string | undefined): PreviewSelector[] {
  if (!raw) throw new Error('INVALID_PROMOTION_SELECTION');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('INVALID_PROMOTION_SELECTION'); }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 2000) throw new Error('INVALID_PROMOTION_SELECTION');
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || typeof item.productId !== 'string' || !item.productId.trim()
      || typeof item.groupKey !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(item.groupKey)) throw new Error('INVALID_PROMOTION_SELECTION');
    if ('allVariants' in item) {
      if (item.allVariants !== true || 'variantId' in item) throw new Error('INVALID_PROMOTION_SELECTION');
    } else if (!(item.variantId === null || (typeof item.variantId === 'string' && item.variantId.trim()))) {
      throw new Error('INVALID_PROMOTION_SELECTION');
    }
  }
  return parsed as PreviewSelector[];
}

async function unifiedCatalogPreview(client: typeof prisma, id: string, body: unknown) {
  return client.$transaction(async (tx) => {
    const row = await tx.promotion.findUnique({ where: { id }, include: { products: true } });
    if (!row) throw new Error('PROMOTION_NOT_FOUND');
    if (!row.ruleDefinition) throw new Error('INVALID_PROMOTION_DEFINITION');
    const definition = parsePromotionDefinition(JSON.parse(row.ruleDefinition));
    const selectorRows = definition.priceBasis === 'catalog' ? await tx.$queryRaw<Array<{ selectorsJson: string }>>`
      SELECT selectorsJson FROM PromotionCatalogSelection WHERE promotionId = ${id}
    ` : [];
    const selectors: PreviewSelector[] = definition.priceBasis === 'catalog'
      ? parseSelectors(selectorRows[0]?.selectorsJson)
      : row.products.map((binding) => ({ productId: binding.productId, variantId: binding.variantId, groupKey: binding.groupKey }));
    const productIds = [...new Set(selectors.map((selector) => selector.productId))];
    const products = await tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, catalogNumber: true, hazardous: true, deletedAt: true },
    });
    const productById = new Map(products.map((product) => [product.id, product]));
    const allVariantProductIds = [...new Set(selectors.filter((selector): selector is Extract<PreviewSelector, { allVariants: true }> => 'allVariants' in selector)
      .map((selector) => selector.productId))];
    const explicitVariantIds = [...new Set(selectors.flatMap((selector) => !('allVariants' in selector) && selector.variantId ? [selector.variantId] : []))];
    const variantOr: Array<Record<string, unknown>> = [];
    if (allVariantProductIds.length) variantOr.push({ productId: { in: allVariantProductIds } });
    if (explicitVariantIds.length) variantOr.push({ id: { in: explicitVariantIds } });
    const variants = variantOr.length ? await tx.productVariant.findMany({
      where: { OR: variantOr },
      select: { id: true, productId: true, catalogNumber: true, spec: true },
      orderBy: [{ productId: 'asc' }, { id: 'asc' }],
      take: 2001,
    }) : [];
    if (variants.length > 2000) throw new Error('INVALID_PROMOTION_SELECTION');
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));
    const bindings: PromotionSkuBinding[] = [];
    const seen = new Set<string>();
    const append = (binding: PromotionSkuBinding) => {
      const key = promotionSkuKey(binding);
      if (seen.has(key)) throw new Error('DUPLICATE_PROMOTION_SKU');
      if (bindings.length >= 2000) throw new Error('INVALID_PROMOTION_SELECTION');
      seen.add(key);
      bindings.push(binding);
    };
    for (const selector of selectors) {
      const product = productById.get(selector.productId);
      if (!product || product.hazardous || product.deletedAt) throw new Error('INVALID_PROMOTION_PRODUCT');
      if ('allVariants' in selector) {
        const productVariants = variants.filter((variant) => variant.productId === product.id);
        if (!productVariants.length) throw new Error('INVALID_PROMOTION_SELECTION');
        for (const variant of productVariants) append({ productId: product.id, variantId: variant.id, groupKey: selector.groupKey });
      } else {
        const variant = selector.variantId === null ? null : variantById.get(selector.variantId);
        if (variant && variant.productId !== product.id) throw new Error('INVALID_PROMOTION_VARIANT');
        if (selector.variantId !== null && !variant) {
          throw new Error('INVALID_PROMOTION_VARIANT');
        }
        append({ productId: product.id, variantId: selector.variantId, groupKey: selector.groupKey });
      }
    }
    validatePromotionBindings(definition, bindings);
    const displayBindings = bindings.map((binding) => {
      const product = productById.get(binding.productId)!;
      const variant = binding.variantId ? variantById.get(binding.variantId) : null;
      return { ...binding, product: { id: product.id, name: product.name, catalogNumber: product.catalogNumber },
        variant: variant ? { id: variant.id, catalogNumber: variant.catalogNumber, spec: variant.spec } : null };
    });
    if (body && typeof body === 'object' && !Array.isArray(body)
      && Object.keys(body).length === 1 && (body as { resolveBindings?: unknown }).resolveBindings === true) {
      return { previewBindings: displayBindings };
    }
    const lineInputs = parsePreviewInput(body, new Set(bindings.map(promotionSkuKey)));
    const now = new Date();
    const previewCampaign: BoundPromotion = {
      id: row.id, name: row.name, version: row.ruleVersion, status: 'active',
      // The target draft is simulated now; database campaigns remain governed by
      // their stored status and start/end times in the snapshot service.
      startsAt: new Date(now.getTime() - 1), endsAt: new Date(now.getTime() + 60_000),
      priority: row.priority, exclusive: row.exclusive, definition, bindings,
    };
    const snapshot = await createUnifiedPricingSnapshot(tx, { lines: lineInputs, now, previewCampaign });
    const ordinaryTotal = snapshot.evidence.lines.reduce((sum, line) => {
      const baseline = definition.priceBasis === 'catalog' ? (line.catalogReferenceCents ?? line.unitPriceCents) : line.unitPriceCents;
      return baseline == null ? sum : sum + BigInt(baseline) * BigInt(line.quantity);
    }, BigInt(0));
    if (ordinaryTotal > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('INVALID_PROMOTION_AMOUNT');
    return {
      ...snapshot.pricing,
      targetApplied: snapshot.pricing.promotionIds.includes(row.id),
      referenceTotalCents: Number(ordinaryTotal),
      statuses: [],
      simulatedAt: now.toISOString(),
      previewBindings: displayBindings,
    };
  });
}

async function post(req: NextRequest, { params }: { params: Promise<{ id: string }> }, dependencies: PreviewDependencies) {
  const admin = await requireAdmin('pricing.read');
  if (admin instanceof NextResponse) return admin;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 }); }
  try {
    const { id } = await params;
    if (dependencies.unifiedPreviewReady) {
      const result = await unifiedCatalogPreview(dependencies.client, id, body);
      return NextResponse.json(result);
    }
    const result = withPromotionRepository((repository, db) => {
      const campaign = repository.get(id);
      if (!campaign.ruleDefinition) throw new Error('INVALID_PROMOTION_DEFINITION');
      // Hard gate: production POST always keeps catalog previews disabled until
      // preview and checkout use a verified shared transaction path.
      if (campaign.ruleDefinition.priceBasis === 'catalog') throw new Error('PROMOTION_CATALOG_RUNTIME_NOT_READY');
      const allowed = new Set(campaign.products.map(promotionSkuKey));
      const lines = parsePreviewInput(body, allowed).map((line, index) => {
        const binding = campaign.products.find((entry) => promotionSkuKey(entry) === promotionSkuKey(line))!;
        const row = db.prepare(`SELECT p.price, v.price AS variantPrice FROM Product p LEFT JOIN ProductVariant v ON v.id=? AND v.productId=p.id WHERE p.id=?`)
          .get(binding.variantId, binding.productId) as { price: number; variantPrice: number | null } | undefined;
        if (!row) throw new Error('INVALID_PROMOTION_PRODUCT');
        const price = row.variantPrice != null && row.variantPrice > 0 ? row.variantPrice : row.price;
        if (!Number.isFinite(price) || price <= 0) throw new Error('INVALID_PROMOTION_PRICE');
        return { id: String(index), productId: binding.productId, variantId: binding.variantId, quantity: line.quantity,
          unitPriceCents: Math.round(price * 100), basePriceCents: Math.round(price * 100) };
      });
      const now = new Date();
      return calculateLegacyPreview(lines, campaign, now);
    });
    return NextResponse.json(result);
  } catch (error) {
    const failure = promotionError(error);
    if (failure.status >= 500) console.error('[promotion preview]', error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}

function calculateLegacyPreview(lines: PromotionPricingLine[], campaign: ManagedPromotion, now: Date) {
  return calculateBoundPromotions(lines, [{ id: campaign.id, name: campaign.name, version: campaign.ruleVersion,
    status: 'active', startsAt: new Date(now.getTime() - 1), endsAt: new Date(now.getTime() + 60_000),
    definition: campaign.ruleDefinition!, bindings: campaign.products,
  }], now);
}

const productionPost = (req: NextRequest, context: { params: Promise<{ id: string }> }) =>
  post(req, context, { unifiedPreviewReady: unifiedPromotionRuntimeEnabled(), client: prisma });

// Test injection supplies a transaction client without accepting readiness from requests.
export const POST = Object.assign(productionPost, {
  forTest: (req: NextRequest, context: { params: Promise<{ id: string }> }, client: typeof prisma) =>
    post(req, context, { unifiedPreviewReady: true, client }),
});
