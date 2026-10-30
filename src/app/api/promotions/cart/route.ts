import { NextRequest, NextResponse } from 'next/server';
import { foundationEnabled, promotionError, withPromotionRepository } from '@/lib/promotion-repository';
import { getEphemeralStore } from '@/lib/ephemeral-store';
import { auth } from '@/lib/auth';
import { requireActiveSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { createUnifiedPricingSnapshot, resolveUnifiedPricingIdentities, type UnifiedPricingRequestLine } from '@/lib/unified-pricing-snapshot';
import { promotionSkuKey } from '@/data/promotion-foundation';
import { allocateUnifiedBandsToSources } from '@/lib/unified-price-band-sources';
import { unifiedPromotionRuntimeEnabled } from '@/lib/unified-promotion-config';
import { getPromotionQualificationViews } from '@/lib/cart-promotions/qualification';
import { CART_ADDON_RULES } from '@/lib/cart-promotions/rules';
import type { CartLine } from '@/lib/cart-promotions/types';

/** 公开接口只返回活动参数及商品身份，不返回数据库价格或客户资料。 */
type CartPreviewDependencies = { ready: boolean; client: typeof prisma; userId: () => Promise<string | null | NextResponse> };

async function sessionUserId(): Promise<string | null | NextResponse> {
  const session = await auth();
  if (!session?.user) return null;
  const user = await requireActiveSession();
  return user instanceof NextResponse ? user : user.id;
}

async function post(req: NextRequest, dependencies: CartPreviewDependencies) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const requests = await getEphemeralStore().increment(`promotion-bindings:${ip}:${Math.floor(Date.now() / 60000)}`, 60000);
    if (requests > 120) return NextResponse.json({ error: '请求较频繁，请稍后重试' }, { status: 429 });
    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 }); }
    if (!Array.isArray(body) || body.length > 200) return NextResponse.json({ error: '商品列表无效' }, { status: 400 });
    if (dependencies.ready) {
      const userId = await dependencies.userId();
      if (userId instanceof NextResponse) return userId;
      const lines: UnifiedPricingRequestLine[] = body.map((raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_PROMOTION_INPUT');
        const item = raw as Record<string, unknown>;
        if (!Number.isSafeInteger(item.quantity) || (item.quantity as number) <= 0) throw new Error('INVALID_PROMOTION_INPUT');
        const mark = item.promoMark;
        if (mark != null && (typeof mark !== 'object' || Array.isArray(mark) || typeof (mark as Record<string, unknown>).ruleId !== 'string')) throw new Error('UNIFIED_PROMO_MARK_INVALID');
        return { productId: typeof item.productId === 'string' ? item.productId : null,
          catalogNumber: typeof item.catalogNumber === 'string' ? item.catalogNumber : null,
          brand: typeof item.brand === 'string' ? item.brand : null,
          variantId: typeof item.variantId === 'string' ? item.variantId : null, quantity: item.quantity as number,
          promoMark: mark == null ? null : mark as UnifiedPricingRequestLine['promoMark'] };
      });
      if (!lines.length) return NextResponse.json({ enabled: true, unified: true, lineTotals: [], lineBands: [], ordinaryLineTotals: [], total: 0, statuses: [] }, { headers: { 'Cache-Control': 'no-store' } });
      const data = await dependencies.client.$transaction(async (tx) => {
        const identities = (await resolveUnifiedPricingIdentities(tx, { lines })).items;
        const products = await tx.product.findMany({ where: { id: { in: [...new Set(identities.map((item) => item.productId))] } },
          select: { id: true, price: true, pricingMode: true, variants: { select: { id: true, price: true } } } });
        const productMap = new Map(products.map((item) => [item.id, item]));
        const uncertain = new Set<string>(); const inquiry = new Set<string>();
        for (const item of identities) {
          const product = productMap.get(item.productId); if (!product) throw new Error('INVALID_PROMOTION_PRODUCT');
          if (product.pricingMode === 'inquiry') { inquiry.add(item.id); continue; }
          const variant = item.variantId ? product.variants.find((entry) => entry.id === item.variantId) : null;
          if (item.variantId && !variant) throw new Error('INVALID_PROMOTION_VARIANT');
          const base = variant ? variant.price : product.price;
          if (typeof base !== 'number' || !Number.isFinite(base) || base <= 0) uncertain.add(item.id);
        }
        const optional = [...uncertain].filter((key) => !inquiry.has(key)).sort();
        const now = new Date();
        const run = async (keys: Set<string>) => {
          const indices = identities.flatMap((item, index) => !inquiry.has(item.id) && (!uncertain.has(item.id) || keys.has(item.id)) ? [index] : []);
          if (!indices.length) return { indices, snapshot: null };
          const subset = indices.map((index) => lines[index]);
          const snapshot = await createUnifiedPricingSnapshot(tx, { lines: subset, userId, now });
          return { indices, snapshot };
        };
        let chosen: Awaited<ReturnType<typeof run>>;
        try { chosen = await run(new Set(optional)); }
        catch (error) {
          if (!(error instanceof Error) || error.message !== 'PROMOTION_PRICE_COVERAGE_REQUIRED') throw error;
          // Exhaustive search is bounded. Multiple incomparable maximal coverage
          // sets require the customer to resolve the cart, rather than guessing.
          if (optional.length > 8) throw new Error('PROMOTION_ENUMERATION_LIMIT');
          const valid: Array<{ mask: number; value: Awaited<ReturnType<typeof run>> }> = [];
          for (let mask = 0; mask < (1 << optional.length); mask++) {
            try {
              const keys = new Set(optional.filter((_, index) => (mask & (1 << index)) !== 0));
              valid.push({ mask, value: await run(keys) });
            } catch (candidateError) {
              if (!(candidateError instanceof Error) || candidateError.message !== 'PROMOTION_PRICE_COVERAGE_REQUIRED') throw candidateError;
            }
          }
          const maximal = valid.filter((candidate) => !valid.some((other) => other.mask !== candidate.mask && (candidate.mask & other.mask) === candidate.mask));
          if (maximal.length !== 1) throw new Error('PROMOTION_COVERAGE_CONFLICT');
          chosen = maximal[0].value;
        }
        const stockBySku = new Map<string, { quantity: number; available: boolean; stock: number | null }>();
        for (const index of chosen.indices) {
          const item = identities[index]; const current = stockBySku.get(item.id) ?? { quantity: 0, available: item.available, stock: item.stockQuantity };
          current.quantity += item.quantity;
          if (!Number.isSafeInteger(current.quantity)) throw new Error('INVALID_PROMOTION_AMOUNT');
          stockBySku.set(item.id, current);
        }
        for (const item of stockBySku.values()) {
          if (!item.available) throw new Error('UNIFIED_PRODUCT_OUT_OF_STOCK');
          if (item.stock !== null && item.stock >= 0 && item.stock < item.quantity) throw new Error('UNIFIED_INSUFFICIENT_STOCK');
        }
        const qualificationLines = new Map<string, CartLine>();
        const lineTotals: Array<number | null> = lines.map(() => null);
        const lineBands: Array<Array<{ quantity: number; unitPriceCents: number }> | null> = lines.map(() => null);
        const ordinaryLineTotals: Array<number | null> = lines.map(() => null);
        const snapshot = chosen.snapshot;
        if (!snapshot) return { enabled: true, unified: true, lineTotals, lineBands, ordinaryLineTotals, total: 0, statuses: [] };
        for (const index of chosen.indices) { lineTotals[index] = 0; lineBands[index] = []; }
        for (const result of snapshot.pricing.lines) {
          const sources = snapshot.items.flatMap((item, index) => promotionSkuKey(item) === promotionSkuKey(result)
            ? [{ sourceIndex: index, quantity: item.quantity, semantics: JSON.stringify({ price: snapshot.evidence.ordinaryUnitPricesCents[index], mark: lines[chosen.indices[index]].promoMark ?? null }) }] : []);
          if (!result.priceBands) throw new Error('UNIFIED_PRICE_BANDS_UNSUPPORTED');
          for (const part of allocateUnifiedBandsToSources(result.priceBands, sources)) {
            const index = chosen.indices[part.sourceIndex]; const total = part.band.unitCents * part.quantity;
            if (!Number.isSafeInteger(total) || !Number.isSafeInteger(lineTotals[index]! + total)) throw new Error('INVALID_PROMOTION_AMOUNT');
            lineTotals[index] = lineTotals[index]! + total;
            lineBands[index]!.push({ quantity: part.quantity, unitPriceCents: part.band.unitCents });

          }
        }
        const selectedSources = new Map<string, { ruleId: string; quantity: number }>();
        snapshot.pricing.promotionIds.forEach((promotionId, index) => {
          const allocationId = snapshot.pricing.allocationIds[index];
          const candidate = snapshot.evidence.legacyCartCandidates.find((entry) => entry.promotionId === promotionId && entry.allocationId === allocationId);
          if (!candidate?.addonSelection) return;
          const rule = CART_ADDON_RULES.find((entry) => `legacy-cart:${entry.id}` === candidate.addonSelection!.ruleId);
          if (!rule) return;
          for (const entry of candidate.addonSelection.selections) {
            const existing = selectedSources.get(entry.sourceLineId);
            if (existing && existing.ruleId !== rule.id) throw new Error('INVALID_PROMOTION_CANDIDATE');
            const quantity = (existing?.quantity ?? 0) + entry.quantity;
            if (!Number.isSafeInteger(quantity)) throw new Error('INVALID_PROMOTION_AMOUNT');
            selectedSources.set(entry.sourceLineId, { ruleId: rule.id, quantity });
          }
        });
        snapshot.items.forEach((identity, localIndex) => {
          const index = chosen.indices[localIndex]; const explicitMark = lines[index].promoMark;
          const selected = selectedSources.get(String(localIndex));
          if (selected && selected.quantity > identity.quantity) throw new Error('INVALID_PROMOTION_CANDIDATE');
          const base = { id: String(index), product: { id: identity.productId, variantId: identity.variantId ?? undefined,
            brand: identity.brand, catalogNumber: identity.catalogNumber, name: identity.name, spec: identity.spec,
            price: snapshot.evidence.ordinaryUnitPricesCents[localIndex] == null ? null : snapshot.evidence.ordinaryUnitPricesCents[localIndex]! / 100,
            serverVerified: true } };
          if (explicitMark) qualificationLines.set(`${index}:marked`, { ...base, quantity: identity.quantity, promoMark: explicitMark });
          else {
            const selectedQuantity = selected?.quantity ?? 0;
            if (selectedQuantity) {
              const rule = CART_ADDON_RULES.find((entry) => entry.id === selected!.ruleId);
              if (!rule) throw new Error('INVALID_PROMOTION_CANDIDATE');
              qualificationLines.set(`${index}:automatic`, { ...base, quantity: selectedQuantity, promoMark: { ruleId: rule.id, price: rule.addonPrice } });
            }
            if (identity.quantity > selectedQuantity) qualificationLines.set(`${index}:ordinary`, { ...base, quantity: identity.quantity - selectedQuantity, promoMark: null });
          }
        });
        if (lineTotals.reduce<number>((sum, cents) => sum + (cents ?? 0), 0) !== snapshot.pricing.totalCents) throw new Error('INVALID_PROMOTION_PLAN');
        snapshot.evidence.ordinaryUnitPricesCents.forEach((unit, index) => {
          if (unit !== null) { const total = unit * lines[chosen.indices[index]].quantity; if (!Number.isSafeInteger(total)) throw new Error('INVALID_PROMOTION_AMOUNT'); ordinaryLineTotals[chosen.indices[index]] = total; }
        });
        const names = new Map([...snapshot.evidence.promotions.map((rule) => [rule.id, rule.name] as const),
          ...snapshot.evidence.legacyCartPromotions.map((rule) => [rule.id, rule.name] as const)]);
        const statuses = snapshot.pricing.promotionIds.map((id, index) => ({ id: `activity-${index}`, name: names.get(id) ?? '促销活动',
          version: 0, qualified: true, groups: [], discountedQuantity: 0, discountCents: 0, message: '活动已应用' }));
        const qualifications = getPromotionQualificationViews([...qualificationLines.values()], CART_ADDON_RULES, now).map((view) => {
          const rule = CART_ADDON_RULES.find((entry) => entry.id === view.ruleId)!;
          return { ...view, name: rule.name, options: rule.addonOptions ?? [],
            canChooseAddon: view.canChooseAddon && !(rule.sharedQuotaMode === 'selection' && !rule.addonOptions?.length) };
        });
        return { enabled: true, unified: true, lineTotals, lineBands, ordinaryLineTotals, total: snapshot.pricing.totalCents, statuses, qualifications };
      });
      return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
    }
    const data = withPromotionRepository((repository, db) => {
      const resolved = body.map((raw: unknown, index: number) => {
        if (!raw || typeof raw !== 'object') throw new Error('INVALID_PROMOTION_PRODUCT');
        const item = raw as Record<string, unknown>;
        const productId = typeof item.productId === 'string' ? item.productId : '';
        const catalog = typeof item.catalogNumber === 'string' ? item.catalogNumber : '';
        const brand = typeof item.brand === 'string' ? item.brand : '';
        const variantId = typeof item.variantId === 'string' ? item.variantId : null;
        type Product = { id: string; catalogNumber: string };
        if (variantId) {
          const variant = db.prepare(`SELECT v.id, v.productId, p.catalogNumber, p.deletedAt AS deletedAt FROM ProductVariant v JOIN Product p ON p.id=v.productId
            WHERE v.id=? AND p.hazardous=0`).get(variantId) as { id: string; productId: string; catalogNumber: string; deletedAt: string | null } | undefined;
          if (!variant || (productId && productId !== variant.productId && productId !== variant.catalogNumber)) throw new Error('INVALID_PROMOTION_VARIANT');
          if (variant.deletedAt) return { id: String(index), productId: '', variantId: null };
          return { id: String(index), productId: variant.productId, variantId: variant.id };
        }
        let product = db.prepare('SELECT id,catalogNumber FROM Product WHERE id=? AND hazardous=0 AND deletedAt IS NULL').get(productId) as Product | undefined;
        if (!product) {
          const matches = db.prepare('SELECT id,catalogNumber FROM Product WHERE catalogNumber=? AND brand=? AND hazardous=0 AND deletedAt IS NULL LIMIT 2').all(catalog || productId, brand) as Product[];
          if (matches.length === 1) product = matches[0];
        }
        return { id: String(index), productId: product?.id ?? '', variantId: null };
      });
      return { resolved, campaigns: repository.activeForProducts(resolved.map((item) => item.productId).filter(Boolean)) };
    });
    // The legacy browser renderer does not preserve marked-row exclusion when
    // applying returned campaigns. Block exact catalog bindings for every row.
    const catalogApplies = data.resolved.some((item) => data.campaigns.some((campaign) => campaign.definition.priceBasis === 'catalog'
      && campaign.bindings.some((binding) => binding.productId === item.productId && binding.variantId === item.variantId)));
    if (catalogApplies) return NextResponse.json({ error: '购物车活动暂时不可用，请稍后重试', code: 'PROMOTION_UNIFIED_RUNTIME_REQUIRED' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } });
    if (!foundationEnabled()) return NextResponse.json({ enabled: false }, { headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ enabled: true, ...data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Error && ['UNIFIED_PRODUCT_OUT_OF_STOCK', 'UNIFIED_INSUFFICIENT_STOCK'].includes(error.message)) return NextResponse.json({ error: '部分商品库存不足，请调整购物车', code: error.message }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof Error && error.message === 'PROMOTION_COVERAGE_CONFLICT') return NextResponse.json({ error: '部分询价商品无法同时适用活动，请调整购物车后重试' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    const failure = promotionError(error);
    if (failure.status >= 500) console.error('[promotion bindings]', error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}

const productionPost = (req: NextRequest) => post(req, { ready: unifiedPromotionRuntimeEnabled(), client: prisma, userId: sessionUserId });
export const POST = Object.assign(productionPost, {
  forTest: (req: NextRequest, dependencies: Omit<CartPreviewDependencies, 'ready'>) => post(req, { ...dependencies, ready: true }),
});
