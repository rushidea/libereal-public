import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildFisherBioReagentsProductWhere } from '@/lib/brand-sub-brands';
import { PRODUCT_ADMIN_LIST_SELECT } from '@/lib/prisma-selects';
import { invalidateProductFilters } from '@/lib/product-filter-cache';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import {
  ensureProductTaxonomy,
  recordProductPriceChanges,
  replaceGeneratedProductRecords,
} from '@/lib/product-catalog-records';
import { setActualInventory } from '@/lib/inventory';
import { requireAdmin } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';
import { ProductSearchService } from '@/lib/product-search';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(req: NextRequest) {
  const admin = await requireAdmin('products.read');
  if (admin instanceof NextResponse) return admin;

  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim() ?? '';
    const quick = searchParams.get('quick') ?? '';
    const take = Math.min(Math.max(Number(searchParams.get('take') ?? 300), 20), 1000);

    let extraWhere: Prisma.ProductWhereInput | undefined;
    if (quick === 'fisher-promo') {
      extraWhere = {
        AND: [
          buildFisherBioReagentsProductWhere() as Prisma.ProductWhereInput,
          { promotion: true },
        ],
      };
    } else if (quick === 'zero-price-promo') {
      extraWhere = { promotion: true, promotionalPrice: { gt: 0 }, price: 0 };
    } else if (quick === 'promotion') {
      extraWhere = { promotion: true };
    } else if (quick === 'hazardous') {
      extraWhere = { hazardous: true };
    }

    const [searchResult, brands, categories, totalProducts] = await Promise.all([
      ProductSearchService.search({ keyword: search, limit: take, sort: 'newest' }, { scope: 'admin', extraWhere }),
      prisma.product.findMany({
        select: { brand: true },
        distinct: ['brand'],
      }),
      prisma.product.findMany({
        select: { category: true },
        distinct: ['category'],
        where: { category: { not: null } },
      }),
      prisma.product.count(),
    ]);

    const stats = {
      totalProducts,
      filteredProducts: searchResult.pagination.total,
      brandsCount: brands.length,
      categoriesCount: categories.length,
      topBrands: brands.slice(0, 10).map(b => b.brand),
    };

    return NextResponse.json({ stats, products: searchResult.products, pagination: searchResult.pagination });
  } catch (err) {
    console.error('[admin/products GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrDefault(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

type VariantInput = {
  id?: string;
  catalogNumber: string;
  spec: string;
  price: number;
  originalPrice: number | null;
  promotionalPrice: number | null;
  costPrice: number | null;
  minimumSalePrice: number | null;
  packageType: string | null;
  salesUnit: string | null;
  baseQuantity: number;
};

const VARIANT_PACKAGE_TYPES = new Set(['box', 'case', 'tier']);

function nullablePackageType(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return VARIANT_PACKAGE_TYPES.has(text) ? text : null;
}

function positiveIntOrDefault(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number >= 1 ? number : fallback;
}

function variantList(value: unknown): VariantInput[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) throw new Error('INVALID_VARIANTS');
  const variants = value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new Error('INVALID_VARIANTS');
    const item = entry as Record<string, unknown>;
    const catalogNumber = String(item.catalogNumber ?? '').trim();
    const spec = String(item.spec ?? '').trim();
    const price = Number(item.price);
    const originalPrice = nullableNumber(item.originalPrice);
    if (!catalogNumber || !spec || !Number.isFinite(price) || price < 0) throw new Error('INVALID_VARIANTS');
    return {
      id: typeof item.id === 'string' ? item.id : undefined,
      catalogNumber,
      spec,
      price,
      originalPrice,
      promotionalPrice: nullableNumber(item.promotionalPrice),
      costPrice: nullableNumber(item.costPrice),
      minimumSalePrice: nullableNumber(item.minimumSalePrice),
      packageType: nullablePackageType(item.packageType),
      salesUnit: nullableString(item.salesUnit),
      baseQuantity: positiveIntOrDefault(item.baseQuantity, 1),
    };
  });
  if (new Set(variants.map((item) => item.catalogNumber)).size !== variants.length) throw new Error('DUPLICATE_VARIANT_CATALOG');
  return variants;
}

/** 规格里是否含内部价字段（进货价/最低成交价），用于判定是否需要 pricing.write。 */
function variantsCarryInternalPricing(variants: VariantInput[] | null): boolean {
  return !!variants && variants.some((item) => item.costPrice !== null || item.minimumSalePrice !== null);
}

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin('products.write');
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await req.json();
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) {
      return NextResponse.json({ error: 'Missing product id' }, { status: 400 });
    }

    const brand = String(body.brand ?? '').trim();
    const category = nullableString(body.category);
    const subcategory = nullableString(body.subcategory);
    const applications = stringList(body.applications);
    const reactivity = stringList(body.reactivity);
    const price = numberOrDefault(body.price, 0);
    const originalPrice = nullableNumber(body.originalPrice);
    const promotionalPrice = nullableNumber(body.promotionalPrice);
    const costPrice = nullableNumber(body.costPrice);
    const minimumSalePrice = nullableNumber(body.minimumSalePrice);
    const variants = variantList(body.variants);
    const requestedStockQuantity = Number.isInteger(Number(body.stockQuantity)) ? Number(body.stockQuantity) : -1;
    if (
      ['price', 'originalPrice', 'promotionalPrice', 'costPrice', 'minimumSalePrice'].some((field) => Object.prototype.hasOwnProperty.call(body, field))
      || variantsCarryInternalPricing(variants)
    ) {
      const pricingAdmin = await requireAdmin('pricing.write');
      if (pricingAdmin instanceof NextResponse) return pricingAdmin;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'stockQuantity')) {
      const inventoryAdmin = await requireAdmin('inventory.write');
      if (inventoryAdmin instanceof NextResponse) return inventoryAdmin;
    }
    const target = nullableString(body.target);
    const host = nullableString(body.host);
    const cloneNumber = nullableString(body.cloneNumber);
    const purity = nullableString(body.purity);
    const concentration = nullableString(body.concentration);
    const cofaUrl = nullableString(body.cofaUrl);
    const sdsUrl = nullableString(body.sdsUrl);

    const data: Prisma.ProductUpdateInput = {
      catalogNumber: String(body.catalogNumber ?? '').trim(),
      name: String(body.name ?? '').trim(),
      brand,
      subBrand: nullableString(body.subBrand),
      category,
      subcategory,
      type: nullableString(body.type),
      spec: nullableString(body.spec),
      target,
      host,
      price,
      originalPrice,
      promotionalPrice,
      promotion: Boolean(body.promotion),
      hazardous: Boolean(body.hazardous),
      costPrice,
      minimumSalePrice,
      applications: JSON.stringify(applications),
      reactivity: JSON.stringify(reactivity),
      leadTime: nullableString(body.leadTime),
      storageTemp: nullableString(body.storageTemp),
      storageBuffer: nullableString(body.storageBuffer),
      expiryDate: nullableString(body.expiryDate),
      lotNumber: nullableString(body.lotNumber),
      cloneNumber,
      purity,
      molecularWeight: nullableNumber(body.molecularWeight),
      isoelectricPoint: nullableNumber(body.isoelectricPoint),
      concentration,
      cofaUrl,
      sdsUrl,
      pmids: JSON.stringify(stringList(body.pmids)),
    };

    if (!data.catalogNumber || !data.name || !data.brand) {
      return NextResponse.json({ error: 'Catalog number, name and brand are required' }, { status: 400 });
    }

    const product = await prisma.$transaction(async (tx) => {
      const previous = await tx.product.findUnique({
        where: { id },
        select: { price: true, originalPrice: true, promotionalPrice: true, costPrice: true, minimumSalePrice: true, stockQuantity: true },
      });
      if (!previous) throw new Error('Product not found');

      const taxonomy = await ensureProductTaxonomy(tx, { brand, category, subcategory });
      await tx.product.update({
        where: { id },
        data: {
          ...data,
          brandRecord: { connect: { id: taxonomy.brandId } },
          categoryRecord: taxonomy.categoryId
            ? { connect: { id: taxonomy.categoryId } }
            : { disconnect: true },
          subcategoryRecord: taxonomy.subcategoryId
            ? { connect: { id: taxonomy.subcategoryId } }
            : { disconnect: true },
        },
      });

      await replaceGeneratedProductRecords(tx, id, {
        target,
        host,
        cloneNumber,
        purity,
        concentration,
        applications,
        reactivity,
        cofaUrl,
        sdsUrl,
      });
      if (variants) {
        const existing = await tx.productVariant.findMany({ where: { productId: id }, select: { id: true } });
        const existingIds = new Set(existing.map((item) => item.id));
        const retainedIds = variants.flatMap((item) => item.id && existingIds.has(item.id) ? [item.id] : []);
        await tx.productVariant.deleteMany({ where: { productId: id, id: { notIn: retainedIds } } });
        for (const variant of variants) {
          const variantData = {
            catalogNumber: variant.catalogNumber,
            spec: variant.spec,
            price: variant.price,
            originalPrice: variant.originalPrice,
            promotionalPrice: variant.promotionalPrice,
            costPrice: variant.costPrice,
            minimumSalePrice: variant.minimumSalePrice,
            packageType: variant.packageType,
            salesUnit: variant.salesUnit,
            baseQuantity: variant.baseQuantity,
          };
          if (variant.id && existingIds.has(variant.id)) {
            await tx.productVariant.update({ where: { id: variant.id }, data: variantData });
          } else {
            await tx.productVariant.create({ data: { productId: id, ...variantData } });
          }
        }
      }
      await recordProductPriceChanges(
        tx,
        id,
        previous,
        { price, originalPrice, promotionalPrice, costPrice, minimumSalePrice },
        admin.id,
      );
      if (requestedStockQuantity !== previous.stockQuantity) {
        await setActualInventory(tx, {
          productId: id,
          actualQuantity: requestedStockQuantity,
          reason: '商品管理人工调整库存',
          actorId: admin.id,
        });
      }
      const priceFieldsChanged = previous.price !== price || previous.originalPrice !== originalPrice || previous.promotionalPrice !== promotionalPrice || previous.costPrice !== costPrice || previous.minimumSalePrice !== minimumSalePrice;
      if (priceFieldsChanged) await writeAuditLog({ actorId: admin.id, actorEmail: admin.email, action: 'product.price_changed', resource: 'pricing', targetType: 'Product', targetId: id, before: previous, after: { price, originalPrice, promotionalPrice, costPrice, minimumSalePrice }, reason: typeof body.reason === 'string' ? body.reason : '商品资料更新' }, tx);
      return tx.product.findUniqueOrThrow({ where: { id }, select: { ...PRODUCT_ADMIN_LIST_SELECT, variants: { orderBy: { catalogNumber: 'asc' } } } });
    });
    invalidateProductFilters();
    await enqueueBackgroundTask('search.index_update', { source: 'admin-product-update' }, {
      priority: -5,
      dedupeKey: `search-index-update:${Math.floor(Date.now() / 60000)}`,
    });

    return NextResponse.json({
      product: {
        ...product,
        applications: JSON.parse(product.applications),
        reactivity: JSON.parse(product.reactivity),
      },
    });
  } catch (err) {
    console.error('[admin/products PUT] error:', err);
    const message = err instanceof Error ? err.message : '';
    if (message === 'INVENTORY_BELOW_RESERVED') return NextResponse.json({ error: message }, { status: 409 });
    if (message === 'INVALID_INVENTORY_QUANTITY') return NextResponse.json({ error: message }, { status: 400 });
    if (message === 'INVALID_VARIANTS' || message === 'DUPLICATE_VARIANT_CATALOG') return NextResponse.json({ error: message }, { status: 400 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
