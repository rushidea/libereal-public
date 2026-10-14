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
import { parseExplicitStockQuantity } from '@/lib/admin-product-stock';
import { requireAdmin } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';
import { ProductSearchService } from '@/lib/product-search';

const STOCK_QUANTITY_ERROR = '库存数量无效。请填写整数，0 表示无库存，-1 表示不限库存。';
const STOCK_STATUS_ERROR = '库存数量为 0 时不能标为有货。请把数量改为大于 0，或改为 -1（不限库存）。';

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
        where: { deletedAt: null },
      }),
      prisma.product.findMany({
        select: { category: true },
        distinct: ['category'],
        where: { deletedAt: null, category: { not: null } },
      }),
      prisma.product.count({ where: { deletedAt: null } }),
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

function hasField(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
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

const GENERATED_RECORD_FIELDS = ['target', 'host', 'cloneNumber', 'purity', 'concentration', 'applications', 'reactivity', 'cofaUrl', 'sdsUrl'] as const;

export async function PUT(req: NextRequest) {
  const admin = await requireAdmin('products.write');
  if (admin instanceof NextResponse) return admin;

  try {
    const payload = await req.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 });
    }
    const body = payload as Record<string, unknown>;
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) {
      return NextResponse.json({ error: 'Missing product id' }, { status: 400 });
    }
    if (hasField(body, 'catalogNumber') && !String(body.catalogNumber ?? '').trim()) {
      return NextResponse.json({ error: 'Catalog number, name and brand are required' }, { status: 400 });
    }
    if (hasField(body, 'name') && !String(body.name ?? '').trim()) {
      return NextResponse.json({ error: 'Catalog number, name and brand are required' }, { status: 400 });
    }
    if (hasField(body, 'brand') && !String(body.brand ?? '').trim()) {
      return NextResponse.json({ error: 'Catalog number, name and brand are required' }, { status: 400 });
    }

    const variants = variantList(body.variants);
    if (
      ['price', 'originalPrice', 'promotionalPrice', 'costPrice', 'minimumSalePrice'].some((field) => hasField(body, field))
      || variantsCarryInternalPricing(variants)
    ) {
      const pricingAdmin = await requireAdmin('pricing.write');
      if (pricingAdmin instanceof NextResponse) return pricingAdmin;
    }

    let requestedStockQuantity: number | undefined;
    if (hasField(body, 'stockQuantity')) {
      const inventoryAdmin = await requireAdmin('inventory.write');
      if (inventoryAdmin instanceof NextResponse) return inventoryAdmin;
      const parsedStock = parseExplicitStockQuantity(body.stockQuantity);
      if (parsedStock === null) {
        return NextResponse.json({ error: STOCK_QUANTITY_ERROR }, { status: 400 });
      }
      requestedStockQuantity = parsedStock;
    }
    let requestedInStock: boolean | undefined;
    if (hasField(body, 'inStock')) {
      if (typeof body.inStock !== 'boolean') {
        return NextResponse.json({ error: '库存状态无效。请选择有货或缺货。' }, { status: 400 });
      }
      requestedInStock = body.inStock;
    }
    if (requestedInStock === true && requestedStockQuantity === 0) {
      return NextResponse.json({ error: STOCK_STATUS_ERROR }, { status: 400 });
    }

    const data: Prisma.ProductUpdateInput = {};
    if (hasField(body, 'catalogNumber')) data.catalogNumber = String(body.catalogNumber ?? '').trim();
    if (hasField(body, 'name')) data.name = String(body.name ?? '').trim();
    if (hasField(body, 'brand')) data.brand = String(body.brand ?? '').trim();
    if (hasField(body, 'subBrand')) data.subBrand = nullableString(body.subBrand);
    if (hasField(body, 'category')) data.category = nullableString(body.category);
    if (hasField(body, 'subcategory')) data.subcategory = nullableString(body.subcategory);
    if (hasField(body, 'type')) data.type = nullableString(body.type);
    if (hasField(body, 'spec')) data.spec = nullableString(body.spec);
    if (hasField(body, 'target')) data.target = nullableString(body.target);
    if (hasField(body, 'host')) data.host = nullableString(body.host);
    if (hasField(body, 'price')) data.price = numberOrDefault(body.price, 0);
    if (hasField(body, 'originalPrice')) data.originalPrice = nullableNumber(body.originalPrice);
    if (hasField(body, 'promotionalPrice')) data.promotionalPrice = nullableNumber(body.promotionalPrice);
    if (hasField(body, 'promotion')) data.promotion = Boolean(body.promotion);
    if (hasField(body, 'hazardous')) data.hazardous = Boolean(body.hazardous);
    if (hasField(body, 'costPrice')) data.costPrice = nullableNumber(body.costPrice);
    if (hasField(body, 'minimumSalePrice')) data.minimumSalePrice = nullableNumber(body.minimumSalePrice);
    if (hasField(body, 'applications')) data.applications = JSON.stringify(stringList(body.applications));
    if (hasField(body, 'reactivity')) data.reactivity = JSON.stringify(stringList(body.reactivity));
    if (hasField(body, 'filterTags')) data.filterTags = JSON.stringify(stringList(body.filterTags));
    if (hasField(body, 'leadTime')) data.leadTime = nullableString(body.leadTime);
    if (hasField(body, 'storageTemp')) data.storageTemp = nullableString(body.storageTemp);
    if (hasField(body, 'storageBuffer')) data.storageBuffer = nullableString(body.storageBuffer);
    if (hasField(body, 'expiryDate')) data.expiryDate = nullableString(body.expiryDate);
    if (hasField(body, 'lotNumber')) data.lotNumber = nullableString(body.lotNumber);
    if (hasField(body, 'cloneNumber')) data.cloneNumber = nullableString(body.cloneNumber);
    if (hasField(body, 'purity')) data.purity = nullableString(body.purity);
    if (hasField(body, 'molecularWeight')) data.molecularWeight = nullableNumber(body.molecularWeight);
    if (hasField(body, 'isoelectricPoint')) data.isoelectricPoint = nullableNumber(body.isoelectricPoint);
    if (hasField(body, 'concentration')) data.concentration = nullableString(body.concentration);
    if (hasField(body, 'cofaUrl')) data.cofaUrl = nullableString(body.cofaUrl);
    if (hasField(body, 'sdsUrl')) data.sdsUrl = nullableString(body.sdsUrl);
    if (hasField(body, 'pmids')) data.pmids = JSON.stringify(stringList(body.pmids));

    const generatedTouched = GENERATED_RECORD_FIELDS.some((field) => hasField(body, field));
    const taxonomyTouched = hasField(body, 'brand') || hasField(body, 'category') || hasField(body, 'subcategory');
    const priceTouched = ['price', 'originalPrice', 'promotionalPrice', 'costPrice', 'minimumSalePrice'].some((field) => hasField(body, field));

    const product = await prisma.$transaction(async (tx) => {
      const previous = await tx.product.findUnique({
        where: { id },
        select: {
          deletedAt: true,
          brand: true,
          category: true,
          subcategory: true,
          target: true,
          host: true,
          cloneNumber: true,
          purity: true,
          concentration: true,
          applications: true,
          reactivity: true,
          cofaUrl: true,
          sdsUrl: true,
          price: true,
          originalPrice: true,
          promotionalPrice: true,
          costPrice: true,
          minimumSalePrice: true,
          stockQuantity: true,
        },
      });
      if (!previous) throw new Error('Product not found');
      if (previous.deletedAt) throw new Error('PRODUCT_DELETED');
      if (requestedInStock === true && requestedStockQuantity === undefined && previous.stockQuantity === 0) {
        throw new Error('STOCK_STATUS_CONFLICT');
      }

      if (taxonomyTouched) {
        const brandName = hasField(body, 'brand') ? String(body.brand ?? '').trim() : previous.brand;
        const category = hasField(body, 'category') ? nullableString(body.category) : previous.category;
        const subcategory = category
          ? (hasField(body, 'subcategory') ? nullableString(body.subcategory) : previous.subcategory)
          : null;
        const taxonomy = await ensureProductTaxonomy(tx, { brand: brandName, category, subcategory });
        data.brandRecord = { connect: { id: taxonomy.brandId } };
        data.categoryRecord = taxonomy.categoryId
          ? { connect: { id: taxonomy.categoryId } }
          : { disconnect: true };
        data.subcategoryRecord = taxonomy.subcategoryId
          ? { connect: { id: taxonomy.subcategoryId } }
          : { disconnect: true };
      }

      if (Object.keys(data).length > 0) {
        await tx.product.update({ where: { id }, data });
      }

      if (generatedTouched) {
        await replaceGeneratedProductRecords(tx, id, {
          target: hasField(body, 'target') ? nullableString(body.target) : previous.target,
          host: hasField(body, 'host') ? nullableString(body.host) : previous.host,
          cloneNumber: hasField(body, 'cloneNumber') ? nullableString(body.cloneNumber) : previous.cloneNumber,
          purity: hasField(body, 'purity') ? nullableString(body.purity) : previous.purity,
          concentration: hasField(body, 'concentration') ? nullableString(body.concentration) : previous.concentration,
          applications: hasField(body, 'applications') ? stringList(body.applications) : stringList(previous.applications),
          reactivity: hasField(body, 'reactivity') ? stringList(body.reactivity) : stringList(previous.reactivity),
          cofaUrl: hasField(body, 'cofaUrl') ? nullableString(body.cofaUrl) : previous.cofaUrl,
          sdsUrl: hasField(body, 'sdsUrl') ? nullableString(body.sdsUrl) : previous.sdsUrl,
        });
      }
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
      const nextPrices = {
        price: hasField(body, 'price') ? numberOrDefault(body.price, 0) : previous.price,
        originalPrice: hasField(body, 'originalPrice') ? nullableNumber(body.originalPrice) : previous.originalPrice,
        promotionalPrice: hasField(body, 'promotionalPrice') ? nullableNumber(body.promotionalPrice) : previous.promotionalPrice,
        costPrice: hasField(body, 'costPrice') ? nullableNumber(body.costPrice) : previous.costPrice,
        minimumSalePrice: hasField(body, 'minimumSalePrice') ? nullableNumber(body.minimumSalePrice) : previous.minimumSalePrice,
      };
      if (priceTouched) {
        await recordProductPriceChanges(tx, id, previous, nextPrices, admin.id);
        const priceFieldsChanged = previous.price !== nextPrices.price
          || previous.originalPrice !== nextPrices.originalPrice
          || previous.promotionalPrice !== nextPrices.promotionalPrice
          || previous.costPrice !== nextPrices.costPrice
          || previous.minimumSalePrice !== nextPrices.minimumSalePrice;
        if (priceFieldsChanged) {
          await writeAuditLog({
            actorId: admin.id,
            actorEmail: admin.email,
            action: 'product.price_changed',
            resource: 'pricing',
            targetType: 'Product',
            targetId: id,
            before: {
              price: previous.price,
              originalPrice: previous.originalPrice,
              promotionalPrice: previous.promotionalPrice,
              costPrice: previous.costPrice,
              minimumSalePrice: previous.minimumSalePrice,
            },
            after: nextPrices,
            reason: typeof body.reason === 'string' ? body.reason : '商品资料更新',
          }, tx);
        }
      }
      let quantity = previous.stockQuantity;
      if (requestedStockQuantity !== undefined && requestedStockQuantity !== previous.stockQuantity) {
        await setActualInventory(tx, {
          productId: id,
          actualQuantity: requestedStockQuantity,
          reason: '商品管理人工调整库存',
          actorId: admin.id,
        });
        const refreshed = await tx.product.findUniqueOrThrow({ where: { id }, select: { stockQuantity: true } });
        quantity = refreshed.stockQuantity;
      }
      if (requestedInStock !== undefined) {
        if (requestedInStock && quantity === 0) throw new Error('STOCK_STATUS_CONFLICT');
        // Apply after setActualInventory. That helper mirrors availability back onto
        // inStock, and an explicit 缺货 choice has to win unless the quantity is 0.
        await tx.product.update({
          where: { id },
          data: { inStock: quantity === 0 ? false : requestedInStock },
        });
      }
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
    if (message === 'PRODUCT_DELETED') return NextResponse.json({ error: '该产品已删除，不能再修改。' }, { status: 409 });
    if (message === 'STOCK_STATUS_CONFLICT') return NextResponse.json({ error: STOCK_STATUS_ERROR }, { status: 400 });
    if (message === 'INVENTORY_BELOW_RESERVED') return NextResponse.json({ error: message }, { status: 409 });
    if (message === 'INVALID_INVENTORY_QUANTITY') return NextResponse.json({ error: message }, { status: 400 });
    if (message === 'INVALID_VARIANTS' || message === 'DUPLICATE_VARIANT_CATALOG') return NextResponse.json({ error: message }, { status: 400 });
    if (message === 'Product not found') return NextResponse.json({ error: '产品不存在或已删除' }, { status: 404 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
