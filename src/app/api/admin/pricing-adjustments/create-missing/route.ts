import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { requireAdminPricingMutation } from '@/lib/admin-pricing-step-up';
import { MAX_MISSING_CATALOG_CREATE, createMissingCatalogProducts } from '@/lib/pricing-adjustment-create';
import { normalizeCatalogNumber } from '@/lib/pricing-adjustment-rules';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) return null;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function parseDrafts(input: unknown) {
  if (!Array.isArray(input)) return { ok: false as const, error: '请选择要导入的商品' };
  const drafts = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const catalogNumber = text(row.catalogNumber);
    const name = text(row.name) || catalogNumber;
    if (!catalogNumber || !name) continue;
    const variants = Array.isArray(row.variants)
      ? row.variants.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const variant = entry as Record<string, unknown>;
        const spec = text(variant.spec);
        const variantCatalog = text(variant.catalogNumber);
        if (!spec || !variantCatalog) return [];
        return [{
          catalogNumber: variantCatalog,
          spec,
          originalPrice: money(variant.originalPrice),
          price: money(variant.price),
          promotionalPrice: money(variant.promotionalPrice),
          costPrice: money(variant.costPrice),
          minimumSalePrice: money(variant.minimumSalePrice),
        }];
      })
      : [];
    drafts.push({
      catalogNumber,
      name,
      spec: text(row.spec),
      brand: text(row.brand),
      originalPrice: money(row.originalPrice),
      price: money(row.price),
      promotionalPrice: money(row.promotionalPrice),
      costPrice: money(row.costPrice),
      minimumSalePrice: money(row.minimumSalePrice),
      variants,
    });
  }
  const unique = [];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const key = normalizeCatalogNumber(draft.catalogNumber);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(draft);
  }
  if (unique.length === 0) return { ok: false as const, error: '没有可导入的商品' };
  if (unique.length > MAX_MISSING_CATALOG_CREATE) {
    return { ok: false as const, error: `单次最多导入 ${MAX_MISSING_CATALOG_CREATE.toLocaleString('zh-CN')} 个商品` };
  }
  return { ok: true as const, drafts: unique };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: '请求格式无效' }, { status: 400 });
  const input = body as Record<string, unknown>;
  const brand = text(input.brand);
  const category = text(input.category);
  const subcategory = text(input.subcategory);
  const autoClassify = input.autoClassify === true;
  const parsed = parseDrafts(input.drafts);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const drafts = parsed.drafts.map((draft) => ({
    ...draft,
    brand: draft.brand || brand,
  }));
  if (drafts.some((draft) => !draft.brand)) {
    return NextResponse.json({ error: '导入新商品需要品牌' }, { status: 400 });
  }
  if (!autoClassify && !category) return NextResponse.json({ error: '请选择分类后再导入商品' }, { status: 400 });

  const pricingAdmin = await requireAdminPricingMutation(typeof input.stepUpToken === 'string' ? input.stepUpToken : undefined);
  if (pricingAdmin instanceof NextResponse) return pricingAdmin;
  const productAdmin = await requireAdmin('products.write', { skipStepUp: true });
  if (productAdmin instanceof NextResponse) return productAdmin;

  try {
    const groups = new Map<string, typeof drafts>();
    for (const draft of drafts) {
      const current = groups.get(draft.brand) ?? [];
      current.push(draft);
      groups.set(draft.brand, current);
    }
    const createdCatalogs: string[] = [];
    const skippedCatalogs: string[] = [];
    const unclassifiedCatalogs: string[] = [];
    let createdCount = 0;
    let skippedCount = 0;
    let classifiedCount = 0;
    let fallbackCount = 0;
    for (const [draftBrand, group] of groups) {
      const result = await createMissingCatalogProducts({
        brand: draftBrand,
        ...(category ? { category } : {}),
        ...(subcategory ? { subcategory } : {}),
        ...(autoClassify ? { autoClassify: true } : {}),
        drafts: group,
        actor: { id: pricingAdmin.id, email: pricingAdmin.email },
      });
      createdCount += result.createdCount;
      skippedCount += result.skippedCount;
      classifiedCount += result.classifiedCount;
      fallbackCount += result.fallbackCount;
      createdCatalogs.push(...result.createdCatalogs);
      skippedCatalogs.push(...result.skippedCatalogs);
      unclassifiedCatalogs.push(...result.unclassifiedCatalogs);
    }
    return NextResponse.json({
      result: {
        createdCount,
        skippedCount,
        classifiedCount,
        fallbackCount,
        createdCatalogs,
        skippedCatalogs,
        unclassifiedCatalogs,
      },
    });
  } catch (error) {
    console.error('[admin/pricing-adjustments/create-missing]', error);
    return NextResponse.json({ error: '导入商品失败' }, { status: 500 });
  }
}
