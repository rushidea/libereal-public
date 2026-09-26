export const PRICE_ADJUSTMENT_FIELDS = ['price', 'promotionalPrice', 'originalPrice'] as const;
export type PriceAdjustmentField = (typeof PRICE_ADJUSTMENT_FIELDS)[number];

export const PRICE_ADJUSTMENT_MODES = ['percent', 'amount', 'set', 'file'] as const;
export type PriceAdjustmentMode = (typeof PRICE_ADJUSTMENT_MODES)[number];

export const FILE_PRICE_FIELDS = ['price', 'promotionalPrice', 'originalPrice', 'costPrice', 'minimumSalePrice'] as const;
export type FilePriceField = (typeof FILE_PRICE_FIELDS)[number];

export type CatalogPriceItem = {
  catalogNumber: string;
  spec?: string;
  name?: string;
  brand?: string;
  originalPrice?: number | null;
  price?: number | null;
  promotionalPrice?: number | null;
  costPrice?: number | null;
  minimumSalePrice?: number | null;
};

export type CatalogMatchResult = {
  catalogNumber: string;
  spec: string;
  matched: boolean;
  name: string | null;
  productName?: string | null;
  nameConflict?: boolean;
  ambiguous?: boolean;
  candidateBrands?: string[];
};

export type CatalogNameReviewItem = {
  catalogNumber: string;
  spec: string;
  importedName: string;
  productName: string;
};

export const PRICE_ADJUSTMENT_DIRECTIONS = ['increase', 'decrease'] as const;
export type PriceAdjustmentDirection = (typeof PRICE_ADJUSTMENT_DIRECTIONS)[number];

export const PRICE_ADJUSTMENT_SCOPES = ['category', 'catalog'] as const;
export type PriceAdjustmentScope = (typeof PRICE_ADJUSTMENT_SCOPES)[number];

export const MAX_PRICE_ADJUSTMENT_CATALOGS = 50000;
export const PRICE_ADJUSTMENT_SAMPLE_LIMIT = 20;

export type PriceAdjustmentRequest = {
  brand: string;
  scope: PriceAdjustmentScope;
  category?: string;
  subcategory?: string;
  catalogNumbers?: string[];
  catalogItems?: CatalogPriceItem[];
  priceField: PriceAdjustmentField;
  mode: PriceAdjustmentMode;
  direction: PriceAdjustmentDirection;
  amount: number;
  includeVariants: boolean;
  reason: string;
  stepUpToken?: string;
};

export type PriceAdjustmentSample = {
  productId: string;
  variantId: string | null;
  brand: string;
  catalogNumber: string;
  name: string;
  currentPrice: number | null;
  nextPrice: number;
  floored: boolean;
  fieldLabel?: string;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isFiniteAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000;
}

export function computeAdjustedPrice(
  current: number | null,
  input: Pick<PriceAdjustmentRequest, 'mode' | 'direction' | 'amount'>,
): number | null {
  if (input.mode === 'set') return roundMoney(Math.max(0, input.amount));
  if (current === null) return null;
  const delta = input.mode === 'percent' ? (current * input.amount) / 100 : input.amount;
  const next = input.direction === 'increase' ? current + delta : current - delta;
  return roundMoney(Math.max(0, next));
}

export function applyPublicPriceFloor(
  next: number,
  minimumSalePrice: number | null | undefined,
  field: PriceAdjustmentField,
): { price: number; floored: boolean } {
  if (field === 'originalPrice' || minimumSalePrice == null || !Number.isFinite(minimumSalePrice)) {
    return { price: next, floored: false };
  }
  if (next + 1e-9 < minimumSalePrice) return { price: roundMoney(minimumSalePrice), floored: true };
  return { price: next, floored: false };
}

export function currentPriceOf(
  record: { price: number; promotionalPrice: number | null; originalPrice: number | null },
  field: PriceAdjustmentField,
): number | null {
  const value = record[field];
  return value == null ? null : value;
}

export function isInquiryPricing(pricingMode: string | null | undefined): boolean {
  return pricingMode === 'inquiry';
}

export function shouldSkipInquiryAdjustment(
  pricingMode: string | null | undefined,
  mode: PriceAdjustmentMode,
): boolean {
  return isInquiryPricing(pricingMode) && mode !== 'set' && mode !== 'file';
}

export function normalizeCatalogNumber(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseOptionalMoney(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) return { ok: false };
  return { ok: true, value: roundMoney(amount) };
}

function parseCatalogItems(input: unknown): { ok: true; items: CatalogPriceItem[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: '请导入货号' };
  const items: CatalogPriceItem[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const catalogNumber = text(row.catalogNumber);
    if (!catalogNumber) continue;
    const spec = text(row.spec);
    const itemName = text(row.name);
    const itemBrand = text(row.brand);
    const originalPrice = parseOptionalMoney(row.originalPrice);
    const price = parseOptionalMoney(row.price);
    const promotionalPrice = parseOptionalMoney(row.promotionalPrice);
    const costPrice = parseOptionalMoney(row.costPrice);
    const minimumSalePrice = parseOptionalMoney(row.minimumSalePrice);
    if (!originalPrice.ok || !price.ok || !promotionalPrice.ok || !costPrice.ok || !minimumSalePrice.ok) {
      return { ok: false, error: '表格价格无效' };
    }
    items.push({
      catalogNumber,
      ...(spec ? { spec } : {}),
      ...(itemName ? { name: itemName } : {}),
      ...(itemBrand ? { brand: itemBrand } : {}),
      originalPrice: originalPrice.value,
      price: price.value,
      promotionalPrice: promotionalPrice.value,
      costPrice: costPrice.value,
      minimumSalePrice: minimumSalePrice.value,
    });
  }
  if (items.length === 0) return { ok: false, error: '没有可用货号' };
  if (items.length > MAX_PRICE_ADJUSTMENT_CATALOGS) {
    return { ok: false, error: `单次最多 ${MAX_PRICE_ADJUSTMENT_CATALOGS.toLocaleString('zh-CN')} 个货号` };
  }
  return { ok: true, items };
}

export function parseCatalogMatchRequest(body: unknown): { ok: true; brand: string; items: CatalogPriceItem[] } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: '请求格式无效' };
  const input = body as Record<string, unknown>;
  const brand = text(input.brand);
  if (!Array.isArray(input.catalogItems)) return { ok: false, error: '请导入货号' };
  const items: CatalogPriceItem[] = [];
  for (const raw of input.catalogItems) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const catalogNumber = text(row.catalogNumber);
    if (!catalogNumber) continue;
    const spec = text(row.spec);
    const itemName = text(row.name);
    const itemBrand = text(row.brand);
    items.push({
      catalogNumber,
      ...(spec ? { spec } : {}),
      ...(itemName ? { name: itemName } : {}),
      ...(itemBrand ? { brand: itemBrand } : {}),
    });
  }
  if (items.length === 0) return { ok: false, error: '没有可用货号' };
  if (items.length > MAX_PRICE_ADJUSTMENT_CATALOGS) {
    return { ok: false, error: `单次最多 ${MAX_PRICE_ADJUSTMENT_CATALOGS.toLocaleString('zh-CN')} 个货号` };
  }
  return { ok: true, brand, items };
}

export function parsePriceAdjustmentRequest(body: unknown): { ok: true; value: PriceAdjustmentRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: '请求格式无效' };
  const input = body as Record<string, unknown>;
  const brand = text(input.brand);
  const scope = text(input.scope);
  const mode = text(input.mode);
  const direction = text(input.direction) || 'increase';
  const reason = text(input.reason);
  const priceField = text(input.priceField) || (mode === 'file' ? 'price' : '');
  const amountRaw = typeof input.amount === 'number' ? input.amount : Number(input.amount);
  const amount = mode === 'file' ? (Number.isFinite(amountRaw) ? amountRaw : 0) : amountRaw;

  if (!PRICE_ADJUSTMENT_SCOPES.includes(scope as PriceAdjustmentScope)) return { ok: false, error: '调价范围无效' };
  if (!PRICE_ADJUSTMENT_FIELDS.includes(priceField as PriceAdjustmentField)) return { ok: false, error: '价格字段无效' };
  if (!PRICE_ADJUSTMENT_MODES.includes(mode as PriceAdjustmentMode)) return { ok: false, error: '调价方式无效' };
  if (!PRICE_ADJUSTMENT_DIRECTIONS.includes(direction as PriceAdjustmentDirection)) return { ok: false, error: '调整方向无效' };
  if (mode !== 'file' && !isFiniteAmount(amount)) return { ok: false, error: '调价数值无效' };
  if (mode === 'percent' && amount > 10000) return { ok: false, error: '百分比过大' };
  if (reason.length < 2 || reason.length > 200) return { ok: false, error: '请填写 2 到 200 字的调价原因' };
  if (mode === 'file' && scope !== 'catalog') return { ok: false, error: '按表格写入时请导入货号' };

  const category = text(input.category);
  const subcategory = text(input.subcategory);

  let catalogNumbers: string[] | undefined;
  let catalogItems: CatalogPriceItem[] | undefined;
  if (scope === 'catalog') {
    if (mode === 'file') {
      const parsedItems = parseCatalogItems(input.catalogItems);
      if (!parsedItems.ok) return parsedItems;
      catalogItems = parsedItems.items;
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const item of catalogItems) {
        const catalog = text(item.catalogNumber);
        if (!catalog) continue;
        const key = normalizeCatalogNumber(catalog);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(catalog);
      }
      catalogNumbers = unique;
    } else {
      if (!Array.isArray(input.catalogNumbers)) return { ok: false, error: '请导入货号' };
      const unique: string[] = [];
      const seen = new Set<string>();
      for (const item of input.catalogNumbers) {
        const value = text(item);
        if (!value) continue;
        const key = normalizeCatalogNumber(value);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(value);
      }
      if (unique.length === 0) return { ok: false, error: '没有可用货号' };
      if (unique.length > MAX_PRICE_ADJUSTMENT_CATALOGS) {
        return { ok: false, error: `单次最多 ${MAX_PRICE_ADJUSTMENT_CATALOGS.toLocaleString('zh-CN')} 个货号` };
      }
      catalogNumbers = unique;
      if (Array.isArray(input.catalogItems) && input.catalogItems.length > 0) {
        const parsedItems = parseCatalogItems(input.catalogItems);
        if (!parsedItems.ok) return parsedItems;
        catalogItems = parsedItems.items;
      }
    }
  }

  return {
    ok: true,
    value: {
      brand,
      scope: scope as PriceAdjustmentScope,
      ...(category ? { category } : {}),
      ...(subcategory ? { subcategory } : {}),
      ...(catalogNumbers ? { catalogNumbers } : {}),
      ...(catalogItems ? { catalogItems } : {}),
      priceField: priceField as PriceAdjustmentField,
      mode: mode as PriceAdjustmentMode,
      direction: direction as PriceAdjustmentDirection,
      amount,
      includeVariants: input.includeVariants !== false,
      reason,
      ...(typeof input.stepUpToken === 'string' && input.stepUpToken.trim()
        ? { stepUpToken: text(input.stepUpToken) }
        : {}),
    },
  };
}
