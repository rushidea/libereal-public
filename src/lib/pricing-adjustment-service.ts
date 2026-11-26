import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { invalidateProductFilters } from '@/lib/product-filter-cache';
import { recordProductPriceChanges } from '@/lib/product-catalog-records';
import { getEphemeralStore } from '@/lib/ephemeral-store';
import { isPriceAdjustmentApprovalHash, priceAdjustmentApprovalHash } from '@/lib/pricing-adjustment-approval';
import { brandDiscountImpactProducts, findPricingQuoteImpact, type PricingQuoteImpact } from '@/lib/pricing-adjustment-impact';
import { CONFIRMED_TIER_DISCOUNT_RATES } from '@/lib/discount';
import { repriceQuotesAfterCatalogChange } from '@/lib/quote-catalog-repricing';
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
  type PriceAdjustmentRequest,
  type PriceAdjustmentSample,
} from '@/lib/pricing-adjustment-rules';
import { assessImportedProductName } from '@/lib/pricing-adjustment-import';

const PRODUCT_PAGE = 200;
const CATALOG_CHUNK = 400;
const REVIEW_ITEM_LIMIT = 200;
const PLAN_TTL_MS = 60 * 60 * 1000;

export class PriceAdjustmentPlanMissingError extends Error {
  constructor() {
    super('请先生成调价预览，再确认执行');
    this.name = 'PriceAdjustmentPlanMissingError';
  }
}

export class PriceAdjustmentApprovalChangedError extends Error {
  constructor() {
    super('确认内容与当前预览不一致，请重新查看预览后确认');
    this.name = 'PriceAdjustmentApprovalChangedError';
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

export type PlannedChange = PriceAdjustmentSample & {
  minimumSalePrice: number | null;
  patch: PricePatch;
  before: PriceSnapshot;
};

export type FilePreviewDraft = {
  unmatchedCatalogs: string[];
  reviewItems: CatalogNameReviewItem[];
  skippedInquiryCount: number;
  skippedUnchangedCount: number;
  skippedMissingCount: number;
  matchedIds: string[];
  changes: PlannedChange[];
};

export type PriceAdjustmentPreview = {
  brandDefaultChange?: { brandId: string; brandName: string; beforeRate: number | null; afterRate: number;
    beforeQuoteLimit?: number | null; afterQuoteLimit?: number | null };
  approvalHash?: string;
  quoteImpact?: { quoteCount: number; pendingOrderCount: number };
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
  brandRecordId: true,
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

const CATALOG_LOOKUP_INDEXES = [
  'CREATE INDEX IF NOT EXISTS "Product_catalog_lower_idx" ON "Product"(LOWER("catalogNumber")) WHERE "deletedAt" IS NULL',
  'CREATE INDEX IF NOT EXISTS "Product_brand_catalog_lower_idx" ON "Product"("brand", LOWER("catalogNumber")) WHERE "deletedAt" IS NULL',
  'CREATE INDEX IF NOT EXISTS "ProductVariant_catalog_lower_idx" ON "ProductVariant"(LOWER("catalogNumber"))',
];

let catalogLookupIndexesReady: Promise<void> | null = null;

export function ensureCatalogLookupIndexes(): Promise<void> {
  if (!catalogLookupIndexesReady) {
    catalogLookupIndexesReady = (async () => {
      for (const statement of CATALOG_LOOKUP_INDEXES) {
        await prisma.$executeRawUnsafe(statement);
      }
    })().catch((error: unknown) => {
      catalogLookupIndexesReady = null;
      throw error;
    });
  }
  return catalogLookupIndexesReady;
}

async function lookupCatalogProductIds(brand: string | undefined, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  await ensureCatalogLookupIndexes();
  const placeholders = keys.map(() => '?').join(', ');
  const brandClause = brand ? 'AND p.brand = ?' : '';
  const params = brand ? [brand, ...keys] : [...keys];
  const productRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT p.id AS id FROM Product p
     WHERE p.deletedAt IS NULL ${brandClause}
     AND LOWER(p.catalogNumber) IN (${placeholders})`,
    ...params,
  );
  const variantRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT DISTINCT v.productId AS id FROM ProductVariant v
     INNER JOIN Product p ON p.id = v.productId
     WHERE p.deletedAt IS NULL ${brandClause}
     AND LOWER(v.catalogNumber) IN (${placeholders})`,
    ...params,
  );
  return [...new Set([...productRows, ...variantRows].map((row) => row.id))];
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

/** The machine preview addresses one exact catalog record and never freezes an approval plan. */
export function previewCatalogRecordPrice(
  product: LoadedProduct,
  variantId: string | null,
  price: number,
) {
  const record = variantId ? product.variants.find(variant => variant.id === variantId) : product;
  if (!record) return null;
  const planned = planRecord(product, record, variantId, {
    brand: product.brand, scope: 'catalog', priceField: 'price', mode: 'set',
    direction: 'increase', amount: price, includeVariants: Boolean(variantId), reason: 'machine_preview',
  });
  return { currentPrice: record.price, nextPrice: planned.change?.nextPrice ?? record.price,
    floored: planned.change?.floored ?? false, changed: planned.change !== undefined };
}

export const catalogRecordPriceSelect = productSelect;

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

type CatalogMatchIndex = Map<string, LoadedProduct[]>;

function buildCatalogMatchIndex(products: LoadedProduct[]): CatalogMatchIndex {
  const index: CatalogMatchIndex = new Map();
  const add = (catalogNumber: string, product: LoadedProduct) => {
    const key = normalizeCatalogNumber(catalogNumber);
    if (!key) return;
    const list = index.get(key);
    if (!list) {
      index.set(key, [product]);
      return;
    }
    if (!list.some((item) => item.id === product.id)) list.push(product);
  };
  for (const product of products) {
    add(product.catalogNumber, product);
    for (const variant of product.variants) add(variant.catalogNumber, product);
  }
  return index;
}

type FileResolve =
  | { status: 'matched'; product: LoadedProduct; record: PricedRecord; variantId: string | null }
  | { status: 'missing' }
  | { status: 'ambiguous'; products: LoadedProduct[] };

function resolveFileItem(index: CatalogMatchIndex, item: CatalogPriceItem): FileResolve {
  const parentKey = normalizeCatalogNumber(item.catalogNumber);
  if (!parentKey) return { status: 'missing' };
  const matches = (index.get(parentKey) ?? []).filter((product) => {
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

function previewFromFileDraft(draft: FilePreviewDraft): PriceAdjustmentPreview {
  const changes = draft.changes;
  return {
    matchedCount: new Set(draft.matchedIds).size,
    changeCount: changes.length,
    skippedInquiryCount: draft.skippedInquiryCount,
    skippedUnchangedCount: draft.skippedUnchangedCount,
    skippedMissingCount: draft.skippedMissingCount,
    flooredCount: changes.filter((change) => change.floored).length,
    unmatchedCatalogs: draft.unmatchedCatalogs.slice(0, 50),
    reviewCount: draft.reviewItems.length,
    reviewItems: draft.reviewItems.slice(0, REVIEW_ITEM_LIMIT),
    samples: fieldSamples(changes),
  };
}

function clonePlannedChange(change: PlannedChange): PlannedChange {
  return { ...change, patch: { ...change.patch }, before: { ...change.before } };
}

export function mergeFilePreviewDrafts(drafts: FilePreviewDraft[]): { preview: PriceAdjustmentPreview; changes: PlannedChange[] } {
  const unmatchedCatalogs: string[] = [];
  const reviewItems: CatalogNameReviewItem[] = [];
  let skippedInquiryCount = 0;
  let skippedUnchangedCount = 0;
  let skippedMissingCount = 0;
  const matchedIds = new Set<string>();
  const byRecord = new Map<string, PlannedChange>();
  const changes: PlannedChange[] = [];

  for (const draft of drafts) {
    unmatchedCatalogs.push(...draft.unmatchedCatalogs);
    reviewItems.push(...draft.reviewItems);
    skippedInquiryCount += draft.skippedInquiryCount;
    skippedUnchangedCount += draft.skippedUnchangedCount;
    skippedMissingCount += draft.skippedMissingCount;
    for (const id of draft.matchedIds) matchedIds.add(id);
    for (const change of draft.changes) {
      const key = recordKey(change.productId, change.variantId);
      const existing = byRecord.get(key);
      if (existing) {
        existing.patch = { ...existing.patch, ...change.patch };
        existing.floored = existing.floored || change.floored;
        applyMergedPublicFloor(existing);
        continue;
      }
      const copy = clonePlannedChange(change);
      byRecord.set(key, copy);
      changes.push(copy);
    }
  }

  return {
    changes,
    preview: previewFromFileDraft({
      unmatchedCatalogs,
      reviewItems,
      skippedInquiryCount,
      skippedUnchangedCount,
      skippedMissingCount,
      matchedIds: [...matchedIds],
      changes,
    }),
  };
}

function draftFileChanges(products: LoadedProduct[], request: PriceAdjustmentRequest): FilePreviewDraft {
  const unmatchedCatalogs: string[] = [];
  const reviewItems: CatalogNameReviewItem[] = [];
  let skippedInquiryCount = 0;
  let skippedUnchangedCount = 0;
  let skippedMissingCount = 0;
  const matchedIds = new Set<string>();
  const byRecord = new Map<string, PlannedChange>();
  const index = buildCatalogMatchIndex(products);

  for (const item of request.catalogItems ?? []) {
    const resolved = resolveFileItem(index, item);
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
    unmatchedCatalogs,
    reviewItems,
    skippedInquiryCount,
    skippedUnchangedCount,
    skippedMissingCount,
    matchedIds: [...matchedIds],
    changes,
  };
}

function planFileChanges(products: LoadedProduct[], request: PriceAdjustmentRequest): {
  preview: PriceAdjustmentPreview;
  changes: PlannedChange[];
} {
  const draft = draftFileChanges(products, request);
  return { changes: draft.changes, preview: previewFromFileDraft(draft) };
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
      const idRows = await lookupCatalogProductIds(request.brand, keys);
      if (idRows.length === 0) continue;
      const rows = await prisma.product.findMany({
        where: { id: { in: idRows } },
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
        deletedAt: null,
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

export async function draftFilePreviewChunk(request: PriceAdjustmentRequest): Promise<FilePreviewDraft> {
  const loaded = await loadProducts(request);
  return draftFileChanges(loaded.products, request);
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

function planCacheKey(approvalHash: string): string {
  return `price-adjustment-plan:${approvalHash}`;
}

type FrozenPlan = { preview: PriceAdjustmentPreview; changes: PlannedChange[]; impact?: PricingQuoteImpact; source?: unknown };

async function sourceSnapshot(changes: Array<{ productId: string }>, db: Prisma.TransactionClient = prisma, targetBrandId?: string) {
  const rows = [];
  for (const ids of chunk([...new Set(changes.map((change) => change.productId))].sort(), CATALOG_CHUNK)) {
    rows.push(...await db.product.findMany({
      where: { id: { in: ids } }, orderBy: { id: 'asc' },
      select: { ...productSelect, deletedAt: true, updatedAt: true,
        variants: { ...productSelect.variants, orderBy: { id: 'asc' } } },
    }));
  }
  // Brand and tier policy are authoritative inputs too, including a previously unset default.
  const brandIds = [...new Set([...(targetBrandId ? [targetBrandId] : []), ...rows.flatMap((row) => row.brandRecordId ? [row.brandRecordId] : [])])];
  const brandNames = [...new Set(rows.filter((row) => !row.brandRecordId).map((row) => row.brand))];
  const brands = await db.brand.findMany({ where: { OR: [{ id: { in: brandIds } }, { name: { in: brandNames } }] }, orderBy: { id: 'asc' },
    select: { id: true, name: true, isActive: true, defaultDiscountRate: true, supplierQuoteRequiredAbove: true, updatedAt: true } });
  return { products: rows, brands, tiers: CONFIRMED_TIER_DISCOUNT_RATES, discountPolicyVersion: 1 };
}

function assertDisplayedBrandSource(preview: PriceAdjustmentPreview, source: Awaited<ReturnType<typeof sourceSnapshot>>) {
  const displayed = preview.brandDefaultChange;
  if (!displayed) return;
  const actual = source.brands.find((brand) => brand.id === displayed.brandId);
  if (!actual?.isActive || actual.name !== displayed.brandName || actual.defaultDiscountRate !== displayed.beforeRate
    || (actual.supplierQuoteRequiredAbove ?? null) !== (displayed.beforeQuoteLimit ?? null)) {
    throw new PriceAdjustmentApprovalChangedError();
  }
}

async function affectedProducts(plan: FrozenPlan, db: Prisma.TransactionClient = prisma) {
  const change = plan.preview.brandDefaultChange;
  return change && (change.beforeRate !== change.afterRate || (change.beforeQuoteLimit ?? null) !== (change.afterQuoteLimit ?? null))
    ? brandDiscountImpactProducts(change.brandId, change.brandName, db) : plan.changes;
}

async function readFrozenPlan(approvalHash: string): Promise<FrozenPlan | null> {
  if (!isPriceAdjustmentApprovalHash(approvalHash)) return null;
  const raw = await getEphemeralStore().get(planCacheKey(approvalHash));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FrozenPlan>;
    if (!parsed.preview || !Array.isArray(parsed.changes)) return null;
    return { preview: parsed.preview, changes: parsed.changes, impact: parsed.impact, source: parsed.source };
  } catch {
    return null;
  }
}

const PLAN_STORE_LIMIT = 8 * 1024 * 1024;

async function writeFrozenPlan(request: PriceAdjustmentRequest, plan: { preview: PriceAdjustmentPreview; changes: PlannedChange[] }): Promise<PriceAdjustmentPreview> {
  const products = await affectedProducts(plan);
  const impact = await findPricingQuoteImpact(products);
  const source = await sourceSnapshot(products, prisma, plan.preview.brandDefaultChange?.brandId);
  assertDisplayedBrandSource(plan.preview, source);
  const unboundPreview = { ...plan.preview };
  delete unboundPreview.approvalHash;
  const preview = { ...unboundPreview, quoteImpact: { quoteCount: impact.quoteIds.length, pendingOrderCount: impact.pendingOrderIds.length } };
  const approvalHash = priceAdjustmentApprovalHash(request, { preview, changes: plan.changes, impact, source });
  const boundPreview = { ...preview, approvalHash };
  const raw = JSON.stringify({ preview: boundPreview, changes: plan.changes, impact, source });
  if (raw.length > PLAN_STORE_LIMIT) {
    throw new Error('PREVIEW_PLAN_TOO_LARGE');
  }
  await getEphemeralStore().set(planCacheKey(approvalHash), raw, PLAN_TTL_MS);
  return boundPreview;
}

export async function readPriceAdjustmentDetails(approvalHash: string, offset: number) {
  const plan = await readFrozenPlan(approvalHash);
  if (!plan) return null;
  const brandChange = plan.preview.brandDefaultChange;
  if (brandChange) {
    const rows: Array<{ productId: string; variantId: null; brand: string; catalogNumber: string; name: string;
      field: string; unit: 'rate' | 'money'; before: number | null; after: number | null }> = brandChange.beforeRate === brandChange.afterRate ? [] : [{
      productId: brandChange.brandId, variantId: null, brand: brandChange.brandName,
      catalogNumber: '全品牌', name: brandChange.brandName, field: '全店默认折扣',
      unit: 'rate', before: brandChange.beforeRate, after: brandChange.afterRate,
    }];
    if ((brandChange.beforeQuoteLimit ?? null) !== (brandChange.afterQuoteLimit ?? null)) rows.push({
      productId: brandChange.brandId, variantId: null, brand: brandChange.brandName,
      catalogNumber: '单个销售包装', name: brandChange.brandName, field: '目录价超过此金额先核验供应商书面回复',
      unit: 'money', before: brandChange.beforeQuoteLimit ?? null, after: brandChange.afterQuoteLimit ?? null,
    });
    return { approvalHash, offset, total: rows.length, rows: rows.slice(offset, offset + 100) };
  }
  const rows = plan.changes.flatMap((change) => FILE_PRICE_FIELDS
    .filter((field) => change.patch[field] != null && !pricesMatch(change.before[field], change.patch[field]))
    .map((field) => ({ productId: change.productId, variantId: change.variantId, brand: change.brand,
      catalogNumber: change.catalogNumber, name: change.name, field: FIELD_LABELS[field],
      before: change.before[field], after: change.patch[field] })));
  return { approvalHash, offset, total: rows.length, rows: rows.slice(offset, offset + 100) };
}

export async function commitPriceAdjustmentPlan(
  request: PriceAdjustmentRequest,
  plan: { preview: PriceAdjustmentPreview; changes: PlannedChange[] },
): Promise<PriceAdjustmentPreview> {
  return writeFrozenPlan(request, plan);
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
  const index = buildCatalogMatchIndex(loaded.products);
  return items.map((item) => {
    const resolved = resolveFileItem(index, item);
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
  if (request.target === 'brand_default_discount') {
    const brand = await prisma.brand.findUnique({ where: { name: request.brand } });
    if (!brand?.isActive) throw new Error('BRAND_NOT_ACTIVE');
    const rate = request.brandDefaultDiscountRate;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 1) throw new Error('INVALID_DISCOUNT_RATE');
    const beforeQuoteLimit = brand.supplierQuoteRequiredAbove ?? null;
    const afterQuoteLimit = request.supplierQuoteRequiredAbove === undefined ? beforeQuoteLimit : request.supplierQuoteRequiredAbove;
    if (afterQuoteLimit !== null && (!Number.isFinite(afterQuoteLimit) || afterQuoteLimit <= 0 || afterQuoteLimit > 1_000_000_000)) throw new Error('INVALID_SUPPLIER_QUOTE_POLICY');
    const changeCount = Number(brand.defaultDiscountRate !== rate) + Number(beforeQuoteLimit !== afterQuoteLimit);
    return writeFrozenPlan(request, { changes: [], preview: {
      brandDefaultChange: { brandId: brand.id, brandName: brand.name, beforeRate: brand.defaultDiscountRate, afterRate: rate, beforeQuoteLimit, afterQuoteLimit },
      matchedCount: 1, changeCount, skippedUnchangedCount: changeCount ? 0 : 1,
      skippedInquiryCount: 0, skippedMissingCount: 0, flooredCount: 0,
      unmatchedCatalogs: [], reviewCount: 0, reviewItems: [], samples: [],
    } });
  }
  const loaded = await loadProducts(request);
  const planned = planChanges(loaded.products, request, loaded.unmatchedCatalogs);
  return writeFrozenPlan(request, planned);
}

export async function applyPriceAdjustment(
  request: PriceAdjustmentRequest,
  actor: { id: string; email: string },
): Promise<PriceAdjustmentPreview & { updatedCount: number; repricedQuotes: Awaited<ReturnType<typeof repriceQuotesAfterCatalogChange>> }> {
  const planned = await readFrozenPlan(request.approvalHash ?? '');
  if (!planned) throw new PriceAdjustmentPlanMissingError();
  const { approvalHash, ...preview } = planned.preview;
  if (!isPriceAdjustmentApprovalHash(request.approvalHash)
    || request.approvalHash !== approvalHash
    || approvalHash !== priceAdjustmentApprovalHash(request, { preview, changes: planned.changes, impact: planned.impact, source: planned.source })) {
    throw new PriceAdjustmentApprovalChangedError();
  }
  const result = await prisma.$transaction(async (tx) => {
      const dedupeKey = `pricing-apply:${approvalHash}`;
      const prior = await tx.backgroundTask.findUnique({ where: { dedupeKey } });
      if (prior?.status === 'succeeded' && prior.result) {
        return { ...JSON.parse(prior.result), updatedCount: 0 };
      }
      const products = await affectedProducts(planned, tx);
      const currentSource = await sourceSnapshot(products, tx, planned.preview.brandDefaultChange?.brandId);
      assertDisplayedBrandSource(planned.preview, currentSource);
      const currentImpact = await findPricingQuoteImpact(products, tx);
      if (priceAdjustmentApprovalHash(request, planned.source) !== priceAdjustmentApprovalHash(request, currentSource)
        || priceAdjustmentApprovalHash(request, planned.impact) !== priceAdjustmentApprovalHash(request, currentImpact)) {
        throw new PriceAdjustmentApprovalChangedError();
      }
      let updatedCount = 0;
      const brandChange = planned.preview.brandDefaultChange;
      if (brandChange && (brandChange.beforeRate !== brandChange.afterRate || (brandChange.beforeQuoteLimit ?? null) !== (brandChange.afterQuoteLimit ?? null))) {
        await tx.brand.update({ where: { id: brandChange.brandId }, data: {
          defaultDiscountRate: brandChange.afterRate,
          ...(brandChange.afterQuoteLimit !== undefined ? { supplierQuoteRequiredAbove: brandChange.afterQuoteLimit } : {}),
        } });
        updatedCount = 1;
      }
      for (const change of planned.changes) {
        const fields = FILE_PRICE_FIELDS.filter((field) => change.patch[field] != null);
        if (fields.length === 0) continue;

        if (change.variantId) {
          const previous = await tx.productVariant.findUnique({
            where: { id: change.variantId },
            select: { price: true, originalPrice: true, promotionalPrice: true, costPrice: true, minimumSalePrice: true },
          });
          if (!previous) throw new PriceAdjustmentApprovalChangedError();
          const drifted = fields.some((field) => !pricesMatch(previous[field], change.before[field]));
          if (drifted) throw new PriceAdjustmentApprovalChangedError();
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
          if (!previous) throw new PriceAdjustmentApprovalChangedError();
          const drifted = fields.some((field) => !pricesMatch(previous[field], change.before[field]));
          if (drifted) throw new PriceAdjustmentApprovalChangedError();
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
      const repricedQuotes = await repriceQuotesAfterCatalogChange(tx, {
        impact: currentImpact, changes: products, approvalHash, actor,
      });
      await writeAuditLog({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'pricing.bulk_adjusted',
    resource: 'pricing',
    targetType: brandChange ? 'Brand' : 'Product',
    targetId: brandChange?.brandId ?? request.brand,
    before: { matchedCount: planned.preview.matchedCount, ...(brandChange ? { defaultDiscountRate: brandChange.beforeRate, supplierQuoteRequiredAbove: brandChange.beforeQuoteLimit } : {}) },
    after: { updatedCount, changeCount: planned.preview.changeCount, priceField: request.priceField, mode: request.mode, approvalHash, repricedQuotes,
      ...(brandChange ? { defaultDiscountRate: brandChange.afterRate, supplierQuoteRequiredAbove: brandChange.afterQuoteLimit } : {}) },
    reason: request.reason,
      }, tx);
      const completed = { ...planned.preview, updatedCount, repricedQuotes };
      await tx.backgroundTask.create({ data: {
        type: 'pricing.apply', status: 'succeeded', dedupeKey, completedAt: new Date(),
        payload: JSON.stringify({ approvalHash, actorId: actor.id }), result: JSON.stringify(completed),
      } });
      return completed;
  }, { timeout: 60_000 });

  invalidateProductFilters();
  try {
    await enqueueBackgroundTask('search.index_update', { source: 'admin-pricing-adjust' }, {
      priority: -5,
      dedupeKey: `search-index-update:${Math.floor(Date.now() / 60000)}`,
    });
  } catch (error) {
    console.error('[pricing-adjustment] search index enqueue failed', error);
  }

  return result;
}
