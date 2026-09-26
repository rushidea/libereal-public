import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { invalidateProductFilters } from '@/lib/product-filter-cache';
import { recordProductPriceChanges } from '@/lib/product-catalog-records';
import { getEphemeralStore } from '@/lib/ephemeral-store';
import {
  applyPublicPriceFloor,
  computeAdjustedPrice,
  currentPriceOf,
  shouldSkipInquiryAdjustment,
  normalizeCatalogNumber,
  PRICE_ADJUSTMENT_SAMPLE_LIMIT,
  FILE_PRICE_FIELDS,
  type CatalogMatchResult,
  type CatalogNameReviewItem,
  type CatalogPriceItem,
  type FilePriceField,
  type PriceAdjustmentField,
  type PriceAdjustmentRequest,
  type PriceAdjustmentSample,
} from '@/lib/pricing-adjustment-rules';
import { assessImportedProductName } from '@/lib/pricing-adjustment-import';

const PRODUCT_PAGE = 200;
const CATALOG_CHUNK = 400;
const APPLY_CHUNK = 40;
const REVIEW_ITEM_LIMIT = 200;
const PLAN_TTL_MS = 60 * 60 * 1000;

export class PriceAdjustmentPlanMissingError extends Error {
  constructor() {
    super('请先生成调价预览，再确认执行');
    this.name = 'PriceAdjustmentPlanMissingError';
  }
}

const FIELD_LABELS: Record<FilePriceField, string> = {
  price: '市场价',
  promotionalPrice: '促销价',
  originalPrice: '目录价',
  costPrice: '进货价',
  minimumSalePrice: '最低成交价',
};

type PriceSnapshot = {
  price: number;
  originalPrice: number | null;
  promotionalPrice: number | null;
  costPrice: number | null;
  minimumSalePrice: number | null;
};

type PricedRecord = PriceSnapshot & {
  id: string;
  catalogNumber: string;
  spec?: string | null;
};

type LoadedProduct = PricedRecord & {
  name: string;
  brand: string;
  pricingMode: string;
  variants: Array<PricedRecord & { spec: string }>;
};

type PricePatch = Partial<Record<FilePriceField, number>>;

type PlannedChange = PriceAdjustmentSample & {
  minimumSalePrice: number | null;
  patch: PricePatch;
  before: PriceSnapshot;
};

export type PriceAdjustmentPreview = {
  matchedCount: number;
  changeCount: number;
  skippedInquiryCount: number;
  skippedUnchangedCount: number;
  skippedMissingCount: number;
  flooredCount: number;
  unmatchedCatalogs: string[];
  reviewCount: number;
  reviewItems: CatalogNameReviewItem[];
  samples: PriceAdjustmentSample[];
};

const productSelect = {
  id: true,
  name: true,
  brand: true,
  catalogNumber: true,
  pricingMode: true,
  price: true,
  originalPrice: true,
  promotionalPrice: true,
  costPrice: true,
  minimumSalePrice: true,
  variants: {
    select: {
      id: true,
      catalogNumber: true,
      spec: true,
      price: true,
      originalPrice: true,
      promotionalPrice: true,
      costPrice: true,
      minimumSalePrice: true,
    },
  },
} satisfies Prisma.ProductSelect;

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

function snapshotOf(record: PriceSnapshot): PriceSnapshot {
  return {
    price: record.price,
    originalPrice: record.originalPrice,
    promotionalPrice: record.promotionalPrice,
    costPrice: record.costPrice,
    minimumSalePrice: record.minimumSalePrice,
  };
}

function displayField(patch: PricePatch): FilePriceField {
  return FILE_PRICE_FIELDS.find((field) => patch[field] != null) ?? 'price';
}

function planRecord(
  product: LoadedProduct,
  record: PricedRecord,
  variantId: string | null,
  request: PriceAdjustmentRequest,
): { change?: PlannedChange; skipped: 'inquiry' | 'missing' | 'unchanged' | null } {
  if (shouldSkipInquiryAdjustment(product.pricingMode, request.mode)) return { skipped: 'inquiry' };
  const current = currentPriceOf(record, request.priceField);
  const computed = computeAdjustedPrice(current, request);
  if (computed === null) return { skipped: 'missing' };
  const floored = applyPublicPriceFloor(computed, record.minimumSalePrice, request.priceField);
  if (current !== null && Math.abs(current - floored.price) < 0.001) return { skipped: 'unchanged' };
  return {
    skipped: null,
    change: {
      productId: product.id,
      variantId,
      brand: product.brand,
      catalogNumber: record.catalogNumber,
      name: variantId ? `${product.name} / ${record.spec || record.catalogNumber}` : product.name,
      currentPrice: current,
      nextPrice: floored.price,
      floored: floored.floored,
      fieldLabel: FIELD_LABELS[request.priceField],
      minimumSalePrice: record.minimumSalePrice,
      patch: { [request.priceField]: floored.price },
      before: snapshotOf(record),
    },
  };
}

function findByCatalog(product: LoadedProduct, token: string): { record: PricedRecord; variantId: string | null } | null {
  const key = normalizeCatalogNumber(token);
  if (!key) return null;
  if (normalizeCatalogNumber(product.catalogNumber) === key) return { record: product, variantId: null };
  const variant = product.variants.find((item) => normalizeCatalogNumber(item.catalogNumber) === key);
  return variant ? { record: variant, variantId: variant.id } : null;
}

function findWithinProduct(product: LoadedProduct, token: string): { record: PricedRecord; variantId: string | null } | null {
  const key = normalizeCatalogNumber(token);
  if (!key) return null;
  const byCatalog = findByCatalog(product, token);
  if (byCatalog) return byCatalog;
  const variant = product.variants.find((item) => normalizeCatalogNumber(item.spec) === key);
  return variant ? { record: variant, variantId: variant.id } : null;
}

function brandMatches(filter: string | undefined, productBrand: string): boolean {
  const key = (filter ?? '').trim().toLocaleLowerCase();
  if (!key) return true;
  return key === productBrand.trim().toLocaleLowerCase();
}

type FileResolve =
  | { status: 'matched'; product: LoadedProduct; record: PricedRecord; variantId: string | null }
  | { status: 'missing' }
  | { status: 'ambiguous'; products: LoadedProduct[] };

function resolveFileItem(products: LoadedProduct[], item: CatalogPriceItem): FileResolve {
  const parentKey = normalizeCatalogNumber(item.catalogNumber);
  const matches = products.filter((product) => {
    if (!brandMatches(item.brand, product.brand)) return false;
    return normalizeCatalogNumber(product.catalogNumber) === parentKey
      || product.variants.some((variant) => normalizeCatalogNumber(variant.catalogNumber) === parentKey);
  });
  if (matches.length === 0) return { status: 'missing' };
  if (matches.length > 1) return { status: 'ambiguous', products: matches };
  const parent = matches[0];
  if (!parent) return { status: 'missing' };
  if (!item.spec) {
    return {
      status: 'matched',
      product: parent,
      ...(findWithinProduct(parent, item.catalogNumber) ?? { record: parent, variantId: null }),
    };
  }
  const nested = findWithinProduct(parent, item.spec);
  return nested
    ? { status: 'matched', product: parent, ...nested }
    : { status: 'missing' };
}

function isCatalogNameConflict(item: CatalogPriceItem, productName: string, brand?: string): boolean {
  return assessImportedProductName(item.name ?? '', productName, { brand: item.brand || brand }).identity === 'conflict';
}

function buildFilePatch(item: CatalogPriceItem, record: PricedRecord): { patch: PricePatch; floored: boolean; skipped: 'missing' | 'unchanged' | null } {
  const nextMin = item.minimumSalePrice ?? record.minimumSalePrice ?? null;
  const patch: PricePatch = {};
  let floored = false;
  let hasInput = false;

  for (const field of FILE_PRICE_FIELDS) {
    const incoming = item[field];
    if (incoming == null) continue;
    hasInput = true;
    if (field === 'promotionalPrice' && incoming === 0) {
      patch[field] = 0;
      continue;
    }
    if (field === 'price' || field === 'promotionalPrice') {
      const result = applyPublicPriceFloor(incoming, nextMin, field);
      patch[field] = result.price;
      if (result.floored) floored = true;
    } else {
      patch[field] = incoming;
    }
  }

  if (!hasInput) return { patch, floored, skipped: 'missing' };

  const changed = FILE_PRICE_FIELDS.filter((field) => patch[field] != null && !pricesMatch(record[field], patch[field]));
  if (changed.length === 0) return { patch, floored, skipped: 'unchanged' };
  const nextPatch: PricePatch = {};
  for (const field of changed) nextPatch[field] = patch[field];
  return { patch: nextPatch, floored, skipped: null };
}

function importedNameByCatalog(items: CatalogPriceItem[] | undefined): Map<string, string> {
  const names = new Map<string, string>();
  for (const item of items ?? []) {
    const importedName = item.name?.trim();
    if (!importedName) continue;
    names.set(normalizeCatalogNumber(item.catalogNumber), importedName);
    if (item.spec) names.set(normalizeCatalogNumber(item.spec), importedName);
  }
  return names;
}

function importedNameForProduct(product: LoadedProduct, names: Map<string, string>): string | undefined {
  return names.get(normalizeCatalogNumber(product.catalogNumber))
    ?? product.variants
      .map((variant) => names.get(normalizeCatalogNumber(variant.catalogNumber)))
      .find((name): name is string => Boolean(name));
}

function itemLabel(item: CatalogPriceItem): string {
  return item.spec ? `${item.catalogNumber} / ${item.spec}` : item.catalogNumber;
}

function toReviewItem(item: CatalogPriceItem, productName: string): CatalogNameReviewItem {
  return {
    catalogNumber: item.catalogNumber,
    spec: item.spec ?? '',
    importedName: item.name ?? '',
    productName,
  };
}

function recordKey(productId: string, variantId: string | null): string {
  return `${productId}:${variantId ?? ''}`;
}

function applyMergedPublicFloor(change: PlannedChange): void {
  const nextMin = change.patch.minimumSalePrice ?? change.minimumSalePrice ?? null;
  change.minimumSalePrice = nextMin;
  for (const field of ['price', 'promotionalPrice'] as const) {
    const value = change.patch[field];
    if (value == null) continue;
    if (field === 'promotionalPrice' && value === 0) continue;
    const result = applyPublicPriceFloor(value, nextMin, field);
    change.patch[field] = result.price;
    if (result.floored) change.floored = true;
  }
  const field = displayField(change.patch);
  change.currentPrice = change.before[field] ?? null;
  change.nextPrice = change.patch[field] ?? 0;
  change.fieldLabel = FIELD_LABELS[field];
}

function fieldSamples(changes: PlannedChange[]): PriceAdjustmentSample[] {
  const rows: PriceAdjustmentSample[] = [];
  for (const change of changes) {
    const fields = FILE_PRICE_FIELDS.filter((field) => change.patch[field] != null);
    for (const field of fields) {
      rows.push({
        productId: change.productId,
        variantId: change.variantId,
        brand: change.brand,
        catalogNumber: change.catalogNumber,
        name: change.name,
        currentPrice: change.before[field] ?? null,
        nextPrice: change.patch[field] ?? 0,
        floored: change.floored && (field === 'price' || field === 'promotionalPrice'),
        fieldLabel: FIELD_LABELS[field],
      });
      if (rows.length >= PRICE_ADJUSTMENT_SAMPLE_LIMIT) return rows;
    }
  }
  return rows;
}

function toPlannedFileChange(
  resolved: { product: LoadedProduct; record: PricedRecord; variantId: string | null },
  planned: { patch: PricePatch; floored: boolean },
): PlannedChange {
  const field = displayField(planned.patch);
  return {
    productId: resolved.product.id,
    variantId: resolved.variantId,
    brand: resolved.product.brand,
    catalogNumber: resolved.record.catalogNumber,
    name: resolved.variantId
      ? `${resolved.product.name} / ${resolved.record.spec || resolved.record.catalogNumber}`
      : resolved.product.name,
    currentPrice: resolved.record[field] ?? null,
    nextPrice: planned.patch[field] ?? 0,
    floored: planned.floored,
    fieldLabel: FIELD_LABELS[field],
    minimumSalePrice: planned.patch.minimumSalePrice ?? resolved.record.minimumSalePrice,
    patch: planned.patch,
    before: snapshotOf(resolved.record),
  };
}

function planFileChanges(products: LoadedProduct[], request: PriceAdjustmentRequest): {
  preview: PriceAdjustmentPreview;
  changes: PlannedChange[];
} {
  const unmatchedCatalogs: string[] = [];
  const reviewItems: CatalogNameReviewItem[] = [];
  let skippedInquiryCount = 0;
  let skippedUnchangedCount = 0;
  let skippedMissingCount = 0;
  const matchedIds = new Set<string>();
  const byRecord = new Map<string, PlannedChange>();

  for (const item of request.catalogItems ?? []) {
    const resolved = resolveFileItem(products, item);
    if (resolved.status === 'missing') {
      unmatchedCatalogs.push(itemLabel(item));
      continue;
    }
    if (resolved.status === 'ambiguous') {
      reviewItems.push({
        catalogNumber: item.catalogNumber,
        spec: item.spec ?? '',
        importedName: item.name ?? '',
        productName: [...new Set(resolved.products.map((product) => product.brand))].join('、'),
      });
      continue;
    }
    if (isCatalogNameConflict(item, resolved.product.name, request.brand)) {
      reviewItems.push(toReviewItem(item, resolved.product.name));
      continue;
    }
    matchedIds.add(resolved.product.id);
    if (shouldSkipInquiryAdjustment(resolved.product.pricingMode, request.mode)) {
      skippedInquiryCount += 1;
      continue;
    }
    const planned = buildFilePatch(item, resolved.record);
    if (planned.skipped === 'missing') {
      skippedMissingCount += 1;
      continue;
    }
    if (planned.skipped === 'unchanged') {
      skippedUnchangedCount += 1;
      continue;
    }
    const key = recordKey(resolved.product.id, resolved.variantId);
    const existing = byRecord.get(key);
    if (existing) {
      existing.patch = { ...existing.patch, ...planned.patch };
      existing.floored = existing.floored || planned.floored;
      applyMergedPublicFloor(existing);
      continue;
    }
    byRecord.set(key, toPlannedFileChange(resolved, planned));
  }

  const changes = [...byRecord.values()];
  return {
    changes,
    preview: {
      matchedCount: matchedIds.size,
      changeCount: changes.length,
      skippedInquiryCount,
      skippedUnchangedCount,
      skippedMissingCount,
      flooredCount: changes.filter((change) => change.floored).length,
      unmatchedCatalogs: unmatchedCatalogs.slice(0, 50),
      reviewCount: reviewItems.length,
      reviewItems: reviewItems.slice(0, REVIEW_ITEM_LIMIT),
      samples: fieldSamples(changes),
    },
  };
}

async function loadProducts(request: PriceAdjustmentRequest): Promise<{ products: LoadedProduct[]; unmatchedCatalogs: string[] }> {
  if (request.scope === 'catalog') {
    const catalogNumbers = request.catalogNumbers?.length
      ? request.catalogNumbers
      : [...new Set((request.catalogItems ?? []).map((item) => item.catalogNumber).filter(Boolean))];
    const products: LoadedProduct[] = [];
    const seen = new Set<string>();
    for (const group of chunk(catalogNumbers, CATALOG_CHUNK)) {
      const keys = [...new Set(group.map(normalizeCatalogNumber).filter(Boolean))];
      if (keys.length === 0) continue;
      const placeholders = keys.map(() => '?').join(', ');
      const brandClause = request.brand ? 'AND p.brand = ?' : '';
      const params = request.brand ? [request.brand, ...keys, ...keys] : [...keys, ...keys];
      const idRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT p.id AS id FROM Product p
         WHERE 1 = 1 ${brandClause}
         AND (
           LOWER(p.catalogNumber) IN (${placeholders})
           OR EXISTS (
             SELECT 1 FROM ProductVariant v
             WHERE v.productId = p.id AND LOWER(v.catalogNumber) IN (${placeholders})
           )
         )`,
        ...params,
      );
      const rows = await prisma.product.findMany({
        where: { id: { in: idRows.map((row) => row.id) } },
        select: productSelect,
      });
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        products.push(row);
      }
    }
    if (request.mode === 'file') return { products, unmatchedCatalogs: [] };
    const matched = new Set<string>();
    for (const product of products) {
      matched.add(normalizeCatalogNumber(product.catalogNumber));
      for (const variant of product.variants) {
        matched.add(normalizeCatalogNumber(variant.catalogNumber));
      }
    }
    return {
      products,
      unmatchedCatalogs: catalogNumbers.filter((catalogNumber) => !matched.has(normalizeCatalogNumber(catalogNumber))),
    };
  }

  const products: LoadedProduct[] = [];
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.product.findMany({
      where: {
        ...(request.brand ? { brand: request.brand } : {}),
        ...(request.category ? { category: request.category } : {}),
        ...(request.subcategory ? { subcategory: request.subcategory } : {}),
      },
      select: productSelect,
      orderBy: { id: 'asc' },
      take: PRODUCT_PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    products.push(...rows);
    if (rows.length < PRODUCT_PAGE) break;
    cursor = rows[rows.length - 1]?.id;
    if (!cursor) break;
  }
  return { products, unmatchedCatalogs: [] };
}

function planChanges(products: LoadedProduct[], request: PriceAdjustmentRequest, unmatchedCatalogs: string[]): {
  preview: PriceAdjustmentPreview;
  changes: PlannedChange[];
} {
  if (request.mode === 'file') return planFileChanges(products, request);

  const catalogSet = request.scope === 'catalog'
    ? new Set((request.catalogNumbers ?? []).map(normalizeCatalogNumber))
    : null;
  const names = importedNameByCatalog(request.catalogItems);
  const changes: PlannedChange[] = [];
  const reviewItems: CatalogNameReviewItem[] = [];
  let skippedInquiryCount = 0;
  let skippedUnchangedCount = 0;
  let skippedMissingCount = 0;

  for (const product of products) {
    const importedName = importedNameForProduct(product, names);
    if (importedName && assessImportedProductName(importedName, product.name, { brand: request.brand }).identity === 'conflict') {
      reviewItems.push({
        catalogNumber: product.catalogNumber,
        spec: '',
        importedName,
        productName: product.name,
      });
      continue;
    }
    const productListed = !catalogSet || catalogSet.has(normalizeCatalogNumber(product.catalogNumber));
    if (productListed) {
      const planned = planRecord(product, product, null, request);
      if (planned.skipped === 'inquiry') skippedInquiryCount += 1;
      else if (planned.skipped === 'missing') skippedMissingCount += 1;
      else if (planned.skipped === 'unchanged') skippedUnchangedCount += 1;
      else if (planned.change) changes.push(planned.change);
    }

    for (const variant of product.variants) {
      const variantListed = !catalogSet || catalogSet.has(normalizeCatalogNumber(variant.catalogNumber)) || catalogSet.has(normalizeCatalogNumber(variant.spec));
      const include = request.includeVariants
        ? (request.scope === 'category' || productListed || variantListed)
        : Boolean(catalogSet && variantListed && !productListed);
      if (!include) continue;
      const planned = planRecord(product, variant, variant.id, request);
      if (planned.skipped === 'inquiry') skippedInquiryCount += 1;
      else if (planned.skipped === 'missing') skippedMissingCount += 1;
      else if (planned.skipped === 'unchanged') skippedUnchangedCount += 1;
      else if (planned.change) changes.push(planned.change);
    }
  }

  return {
    changes,
    preview: {
      matchedCount: products.length,
      changeCount: changes.length,
      skippedInquiryCount,
      skippedUnchangedCount,
      skippedMissingCount,
      flooredCount: changes.filter((change) => change.floored).length,
      unmatchedCatalogs: unmatchedCatalogs.slice(0, 50),
      reviewCount: reviewItems.length,
      reviewItems: reviewItems.slice(0, REVIEW_ITEM_LIMIT),
      samples: fieldSamples(changes),
    },
  };
}

function nextSnapshot(current: PriceSnapshot, patch: PricePatch): PriceSnapshot {
  return {
    price: patch.price ?? current.price,
    originalPrice: patch.originalPrice !== undefined ? patch.originalPrice : current.originalPrice,
    promotionalPrice: patch.promotionalPrice !== undefined ? patch.promotionalPrice : current.promotionalPrice,
    costPrice: patch.costPrice !== undefined ? patch.costPrice : current.costPrice,
    minimumSalePrice: patch.minimumSalePrice !== undefined ? patch.minimumSalePrice : current.minimumSalePrice,
  };
}

function pricesMatch(left: number | null | undefined, right: number | null | undefined): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(left - right) < 0.001;
}

function priceKind(field: FilePriceField): string {
  if (field === 'originalPrice') return 'original';
  if (field === 'promotionalPrice') return 'promotion';
  if (field === 'costPrice') return 'cost';
  if (field === 'minimumSalePrice') return 'minimum_sale';
  return 'list';
}

function planCacheKey(request: PriceAdjustmentRequest): string {
  const payload = JSON.stringify({
    brand: request.brand,
    scope: request.scope,
    category: request.category ?? null,
    subcategory: request.subcategory ?? null,
    catalogNumbers: request.catalogNumbers ?? [],
    catalogItems: request.catalogItems ?? [],
    priceField: request.priceField,
    mode: request.mode,
    direction: request.direction,
    amount: request.amount,
    includeVariants: request.includeVariants,
  });
  return `price-adjustment-plan:${createHash('sha256').update(payload).digest('hex')}`;
}

async function readFrozenPlan(request: PriceAdjustmentRequest): Promise<{ preview: PriceAdjustmentPreview; changes: PlannedChange[] } | null> {
  const raw = await getEphemeralStore().get(planCacheKey(request));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { preview?: PriceAdjustmentPreview; changes?: PlannedChange[] };
    if (!parsed.preview || !Array.isArray(parsed.changes)) return null;
    return { preview: parsed.preview, changes: parsed.changes };
  } catch {
    return null;
  }
}

const PLAN_STORE_LIMIT = 8 * 1024 * 1024;

async function writeFrozenPlan(request: PriceAdjustmentRequest, plan: { preview: PriceAdjustmentPreview; changes: PlannedChange[] }): Promise<void> {
  const raw = JSON.stringify(plan);
  if (raw.length > PLAN_STORE_LIMIT) {
    throw new Error('PREVIEW_PLAN_TOO_LARGE');
  }
  await getEphemeralStore().set(planCacheKey(request), raw, PLAN_TTL_MS);
}

export async function matchCatalogItems(brand: string, items: CatalogPriceItem[]): Promise<CatalogMatchResult[]> {
  const catalogNumbers: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const catalog = item.catalogNumber.trim();
    if (!catalog) continue;
    const key = normalizeCatalogNumber(catalog);
    if (seen.has(key)) continue;
    seen.add(key);
    catalogNumbers.push(catalog);
  }
  const loaded = await loadProducts({
    brand,
    scope: 'catalog',
    catalogNumbers,
    catalogItems: items,
    priceField: 'price',
    mode: 'file',
    direction: 'increase',
    amount: 0,
    includeVariants: false,
    reason: 'match',
  });
  return items.map((item) => {
    const resolved = resolveFileItem(loaded.products, item);
    if (resolved.status === 'missing') {
      return { catalogNumber: item.catalogNumber, spec: item.spec ?? '', matched: false, name: null, productName: null };
    }
    if (resolved.status === 'ambiguous') {
      const brands = [...new Set(resolved.products.map((product) => product.brand))];
      return {
        catalogNumber: item.catalogNumber,
        spec: item.spec ?? '',
        matched: false,
        name: brands.join('、'),
        productName: brands.join('、'),
        ambiguous: true,
        candidateBrands: brands,
      };
    }
    if (isCatalogNameConflict(item, resolved.product.name, brand || item.brand)) {
      return {
        catalogNumber: item.catalogNumber,
        spec: item.spec ?? '',
        matched: false,
        name: resolved.product.name,
        productName: resolved.product.name,
        nameConflict: true,
      };
    }
    const specLabel = resolved.record.spec || resolved.record.catalogNumber || '';
    return {
      catalogNumber: item.catalogNumber,
      spec: item.spec ?? '',
      matched: true,
      name: resolved.variantId ? `${resolved.product.name} / ${specLabel}` : resolved.product.name,
      productName: resolved.product.name,
    };
  });
}

export async function previewPriceAdjustment(request: PriceAdjustmentRequest): Promise<PriceAdjustmentPreview> {
  const loaded = await loadProducts(request);
  const planned = planChanges(loaded.products, request, loaded.unmatchedCatalogs);
  await writeFrozenPlan(request, planned);
  return planned.preview;
}

export async function applyPriceAdjustment(
  request: PriceAdjustmentRequest,
  actor: { id: string; email: string },
): Promise<PriceAdjustmentPreview & { updatedCount: number }> {
  const planned = await readFrozenPlan(request);
  if (!planned) throw new PriceAdjustmentPlanMissingError();
  let updatedCount = 0;

  for (const group of chunk(planned.changes, APPLY_CHUNK)) {
    await prisma.$transaction(async (tx) => {
      for (const change of group) {
        const fields = FILE_PRICE_FIELDS.filter((field) => change.patch[field] != null);
        if (fields.length === 0) continue;

        if (change.variantId) {
          const previous = await tx.productVariant.findUnique({
            where: { id: change.variantId },
            select: { price: true, originalPrice: true, promotionalPrice: true, costPrice: true, minimumSalePrice: true },
          });
          if (!previous) continue;
          const drifted = fields.some((field) => !pricesMatch(previous[field], change.before[field]));
          if (drifted) continue;
          const unchanged = fields.every((field) => pricesMatch(previous[field], change.patch[field]));
          if (unchanged) continue;
          await tx.productVariant.update({
            where: { id: change.variantId },
            data: change.patch,
          });
          await tx.productPrice.createMany({
            data: fields.map((field) => ({
              productId: change.productId,
              variantId: change.variantId,
              kind: priceKind(field),
              amount: change.patch[field] as number,
              source: 'admin_bulk',
              createdBy: actor.id,
            })),
          });
        } else {
          const previous = await tx.product.findUnique({
            where: { id: change.productId },
            select: { price: true, originalPrice: true, promotionalPrice: true, costPrice: true, minimumSalePrice: true, pricingMode: true },
          });
          if (!previous) continue;
          const drifted = fields.some((field) => !pricesMatch(previous[field], change.before[field]));
          if (drifted) continue;
          const unchanged = fields.every((field) => pricesMatch(previous[field], change.patch[field]));
          if (unchanged) continue;
          const next = nextSnapshot(previous, change.patch);
          await tx.product.update({
            where: { id: change.productId },
            data: {
              ...change.patch,
              ...(change.patch.promotionalPrice != null ? { promotion: change.patch.promotionalPrice > 0 } : {}),
              ...(change.patch.price != null && change.patch.price > 0 && previous.pricingMode === 'inquiry' && (request.mode === 'set' || request.mode === 'file')
                ? { pricingMode: 'fixed' }
                : {}),
            },
          });
          await recordProductPriceChanges(tx, change.productId, previous, next, actor.id);
        }
        updatedCount += 1;
      }
    });
  }

  await writeAuditLog({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'pricing.bulk_adjusted',
    resource: 'pricing',
    targetType: 'Product',
    targetId: request.brand,
    before: { matchedCount: planned.preview.matchedCount },
    after: { updatedCount, changeCount: planned.preview.changeCount, priceField: request.priceField, mode: request.mode },
    reason: request.reason,
  });

  invalidateProductFilters();
  try {
    await enqueueBackgroundTask('search.index_update', { source: 'admin-pricing-adjust' }, {
      priority: -5,
      dedupeKey: `search-index-update:${Math.floor(Date.now() / 60000)}`,
    });
  } catch (error) {
    console.error('[pricing-adjustment] search index enqueue failed', error);
  }

  return { ...planned.preview, updatedCount };
}
