import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { invalidateProductFilters } from '@/lib/product-filter-cache';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { ensureProductTaxonomy, recordProductPriceChanges } from '@/lib/product-catalog-records';
import { normalizeCatalogNumber } from '@/lib/pricing-adjustment-rules';
import type { MissingCatalogDraft } from '@/lib/pricing-adjustment-import';
import { applyClassifyFallback, classifyProduct } from '@/data/product-smart-classify';
import { loadProductClassifyIndex } from '@/lib/product-smart-classify-catalog';

export const MAX_MISSING_CATALOG_CREATE = 2000;

type Actor = { id: string; email: string };

function money(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) || value < 0 ? null : value;
}

function publicPrice(value: number | null): number {
  return value ?? 0;
}

function pricingModeOf(draft: MissingCatalogDraft): 'fixed' | 'inquiry' {
  if ((draft.price != null && draft.price > 0) || draft.originalPrice != null || draft.promotionalPrice != null) {
    return 'fixed';
  }
  if (draft.variants.some((item) => (item.price != null && item.price > 0) || item.originalPrice != null || item.promotionalPrice != null)) {
    return 'fixed';
  }
  return 'inquiry';
}

async function catalogTaken(brand: string, catalogNumber: string): Promise<boolean> {
  const key = normalizeCatalogNumber(catalogNumber);
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT p.id AS id FROM Product p
     WHERE p.brand = ?
     AND (
       LOWER(p.catalogNumber) = ?
       OR EXISTS (
         SELECT 1 FROM ProductVariant v
         WHERE v.productId = p.id AND LOWER(v.catalogNumber) = ?
       )
     )
     LIMIT 1`,
    brand,
    key,
    key,
  );
  return rows.length > 0;
}

export async function createMissingCatalogProducts(input: {
  brand: string;
  category?: string;
  subcategory?: string;
  autoClassify?: boolean;
  drafts: MissingCatalogDraft[];
  actor: Actor;
}): Promise<{
  createdCount: number;
  skippedCount: number;
  classifiedCount: number;
  fallbackCount: number;
  createdCatalogs: string[];
  skippedCatalogs: string[];
  unclassifiedCatalogs: string[];
}> {
  const createdCatalogs: string[] = [];
  const skippedCatalogs: string[] = [];
  const unclassifiedCatalogs: string[] = [];
  let classifiedCount = 0;
  let fallbackCount = 0;
  const index = input.autoClassify ? await loadProductClassifyIndex() : undefined;

  for (const draft of input.drafts) {
    const catalogNumber = draft.catalogNumber.trim();
    const name = draft.name.trim() || catalogNumber;
    if (!catalogNumber || !name) {
      skippedCatalogs.push(catalogNumber || name);
      continue;
    }
    if (await catalogTaken(input.brand, catalogNumber)) {
      skippedCatalogs.push(catalogNumber);
      continue;
    }
    if (draft.variants.some((item) => !item.spec.trim() || !item.catalogNumber.trim())) {
      skippedCatalogs.push(catalogNumber);
      continue;
    }

    const price = publicPrice(money(draft.price));
    const originalPrice = money(draft.originalPrice);
    const promotionalPrice = money(draft.promotionalPrice);
    const costPrice = money(draft.costPrice);
    const minimumSalePrice = money(draft.minimumSalePrice);
    const pricingMode = pricingModeOf(draft);
    const spec = draft.spec.trim() || null;
    const classified = input.autoClassify
      ? classifyProduct({ name, brand: input.brand, catalogNumber, spec }, { index })
      : null;
    const placement = input.autoClassify
      ? applyClassifyFallback(classified ?? { ok: false, confidence: 0, reason: 'unclassified' }, {
          category: input.category,
          subcategory: input.subcategory,
        })
      : {
          category: input.category || '',
          subcategory: input.subcategory || '',
          type: null,
          confidence: 1,
          reason: 'manual',
        };
    if (!placement?.category) {
      skippedCatalogs.push(catalogNumber);
      unclassifiedCatalogs.push(catalogNumber);
      continue;
    }
    if (placement.reason === 'fallback') fallbackCount += 1;
    else if (input.autoClassify) classifiedCount += 1;

    await prisma.$transaction(async (tx) => {
      const taxonomy = await ensureProductTaxonomy(tx, {
        brand: input.brand,
        category: placement.category,
        subcategory: placement.subcategory || null,
      });
      const product = await tx.product.create({
        data: {
          catalogNumber,
          name,
          brand: input.brand,
          price,
          pricingMode,
          originalPrice,
          promotionalPrice,
          promotion: promotionalPrice != null && promotionalPrice > 0,
          costPrice,
          minimumSalePrice,
          category: placement.category,
          subcategory: placement.subcategory || null,
          ...(placement.type ? { type: placement.type } : {}),
          spec,
          applications: '[]',
          reactivity: '[]',
          inStock: true,
          brandRecord: { connect: { id: taxonomy.brandId } },
          ...(taxonomy.categoryId ? { categoryRecord: { connect: { id: taxonomy.categoryId } } } : {}),
          ...(taxonomy.subcategoryId ? { subcategoryRecord: { connect: { id: taxonomy.subcategoryId } } } : {}),
        },
      });
      await recordProductPriceChanges(tx, product.id, {
        price: 0,
        originalPrice: null,
        promotionalPrice: null,
        costPrice: null,
        minimumSalePrice: null,
      }, {
        price,
        originalPrice,
        promotionalPrice,
        costPrice,
        minimumSalePrice,
      }, input.actor.id);

      for (const variant of draft.variants) {
        const created = await tx.productVariant.create({
          data: {
            productId: product.id,
            catalogNumber: variant.catalogNumber.trim(),
            spec: variant.spec.trim(),
            price: publicPrice(money(variant.price)),
            originalPrice: money(variant.originalPrice),
            promotionalPrice: money(variant.promotionalPrice),
            costPrice: money(variant.costPrice),
            minimumSalePrice: money(variant.minimumSalePrice),
          },
        });
        await recordProductPriceChanges(tx, product.id, {
          price: 0,
          originalPrice: null,
          promotionalPrice: null,
          costPrice: null,
          minimumSalePrice: null,
        }, {
          price: created.price,
          originalPrice: created.originalPrice,
          promotionalPrice: created.promotionalPrice,
          costPrice: created.costPrice,
          minimumSalePrice: created.minimumSalePrice,
        }, input.actor.id);
      }

      await writeAuditLog({
        actorId: input.actor.id,
        actorEmail: input.actor.email,
        action: 'product.create',
        resource: 'pricing-adjustments',
        targetType: 'product',
        targetId: product.id,
        after: { catalogNumber, name, brand: input.brand, category: placement.category, subcategory: placement.subcategory || null },
        reason: '集中调价导入未找到的商品',
      }, tx);
    });
    createdCatalogs.push(catalogNumber);
  }

  if (createdCatalogs.length > 0) {
    invalidateProductFilters();
    try {
      await enqueueBackgroundTask('search.index_update', { source: 'admin-pricing-create-missing' }, {
        priority: -5,
        dedupeKey: `search-index-update:${Math.floor(Date.now() / 60000)}`,
      });
    } catch (error) {
      console.error('[pricing-adjustment] search index enqueue failed', error);
    }
  }

  return {
    createdCount: createdCatalogs.length,
    skippedCount: skippedCatalogs.length,
    classifiedCount,
    fallbackCount,
    createdCatalogs,
    skippedCatalogs: skippedCatalogs.slice(0, 50),
    unclassifiedCatalogs: unclassifiedCatalogs.slice(0, 50),
  };
}
