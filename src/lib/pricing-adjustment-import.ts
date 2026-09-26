import {
  MAX_PRICE_ADJUSTMENT_CATALOGS,
  normalizeCatalogNumber,
  type CatalogMatchResult,
  type CatalogPriceItem,
} from '@/lib/pricing-adjustment-rules';

export type ImportedAdjustmentStatus = 'ready' | 'warning' | 'invalid' | 'duplicate' | 'review';

export type ImportedAdjustmentRow = {
  rowNumber: number;
  brand: string;
  name: string;
  catalogNumber: string;
  spec: string;
  specIndex: number;
  originalPrice: number | null;
  price: number | null;
  promotionalPrice: number | null;
  costPrice: number | null;
  minimumSalePrice: number | null;
  status: ImportedAdjustmentStatus;
  note: string;
  siteName?: string;
  candidateBrands?: string[];
};

const SPEC_HEADER = /^规格([2-9]|[1-9]\d+)$/;

const PRICE_HEADER_ALIASES: Record<keyof Pick<ImportedAdjustmentRow, 'originalPrice' | 'price' | 'promotionalPrice' | 'costPrice' | 'minimumSalePrice'>, string[]> = {
  originalPrice: ['目录价格', '目录价', '划线价', 'originalprice', 'listprice'],
  price: ['市场价格', '市场价', '当前价格', '原价格', '售价', 'price'],
  promotionalPrice: ['促销价格', '促销价', 'promotionalprice', 'promoprice'],
  costPrice: ['进货价', '成本价', '经销商价', 'costprice'],
  minimumSalePrice: ['最低成交价', '最低价', '最低销售价', 'minimumsaleprice'],
};

const NAME_STOPWORDS = new Set([
  'antibody', 'antibodies', 'anti', 'mab', 'pab', 'monoclonal', 'polyclonal',
  'rabbit', 'mouse', 'rat', 'goat', 'human', 'igg',
  'recombinant', 'protein', 'peptide', 'kit',
  'primary', 'secondary', 'clone',
  'the', 'and', 'for', 'with', 'from',
  '抗体', '单抗', '多抗', '重组', '试剂盒', '蛋白', '试剂',
  '一抗', '二抗',
]);

const NAME_OVERLAP_MIN = 0.5;
const NAME_SIMILAR_MIN_LENGTH = 6;
const NAME_ALIGN_MIN_LENGTH = 3;

export type ImportedNameIdentity = 'skip' | 'align' | 'keyword' | 'similar' | 'conflict';
export type NameAssessOptions = { brand?: string };

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-./（）()]/g, '');
}

function normalizeLabel(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, '');
}

function compactName(value: string): string {
  return normalizeLabel(value).replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function brandTokens(brand?: string): Set<string> {
  if (!brand?.trim()) return new Set();
  return new Set(
    brand
      .toLocaleLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  );
}

function isGenericToken(token: string, brand?: string): boolean {
  return NAME_STOPWORDS.has(token) || brandTokens(brand).has(token);
}

function genericFragments(brand?: string): string[] {
  return [...NAME_STOPWORDS, ...brandTokens(brand)]
    .filter((word) => word.length >= 2)
    .sort((left, right) => right.length - left.length);
}

function stripGenericSubstrings(value: string, brand?: string): string {
  let text = value;
  for (const word of genericFragments(brand)) {
    if (!text.includes(word)) continue;
    text = text.split(word).join('');
  }
  return text;
}

function nameKeywords(value: string, brand?: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !isGenericToken(token, brand)),
  );
}

function distinctiveCompact(value: string, brand?: string): string {
  const fromTokens = [...nameKeywords(value, brand)].join('');
  return stripGenericSubstrings(compactName(fromTokens || value), brand);
}

function nameBigrams(text: string): Set<string> {
  const grams = new Set<string>();
  if (text.length === 1) grams.add(text);
  for (let index = 0; index < text.length - 1; index += 1) grams.add(text.slice(index, index + 2));
  return grams;
}

function setJaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

export function importedNameOverlap(imported: string, productName: string, brand?: string): number {
  return setJaccard(nameBigrams(distinctiveCompact(imported, brand)), nameBigrams(distinctiveCompact(productName, brand)));
}

function keywordsAlign(imported: string, productName: string, brand?: string): boolean {
  const left = nameKeywords(imported, brand);
  const right = nameKeywords(productName, brand);
  if (left.size === 0 || right.size === 0) return false;
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  for (const token of smaller) {
    if (!larger.has(token)) return false;
  }
  return true;
}

export function importNamesAlign(imported: string, productName: string, brand?: string): boolean {
  const left = compactName(imported);
  const right = compactName(productName);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (isGenericToken(shorter, brand)) return false;
  if (shorter.length < NAME_ALIGN_MIN_LENGTH) return false;
  return longer.includes(shorter);
}

export function assessImportedProductName(imported: string, productName: string, options?: NameAssessOptions): {
  identity: ImportedNameIdentity;
  overlap: number;
} {
  const brand = options?.brand;
  const overlap = importedNameOverlap(imported, productName, brand);
  if (!imported.trim() || !productName.trim()) return { identity: 'skip', overlap };
  if (importNamesAlign(imported, productName, brand)) return { identity: 'align', overlap: Math.max(overlap, 1) };
  const left = distinctiveCompact(imported, brand);
  const right = distinctiveCompact(productName, brand);
  if (left && right && left === right) return { identity: 'align', overlap: Math.max(overlap, 1) };
  if (keywordsAlign(imported, productName, brand)) return { identity: 'keyword', overlap };
  if (left.length >= NAME_SIMILAR_MIN_LENGTH && right.length >= NAME_SIMILAR_MIN_LENGTH && overlap >= NAME_OVERLAP_MIN) {
    return { identity: 'similar', overlap };
  }
  return { identity: 'conflict', overlap };
}

function headerIndex(names: string[], aliases: string[]): number {
  return names.findIndex((name) => aliases.map(normalizeHeader).includes(normalizeHeader(name)));
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

export function parseImportPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round((value + Number.EPSILON) * 100) / 100 : null;
  const number = Number(String(value).replace(/[¥￥,\s]/g, ''));
  return Number.isFinite(number) && number >= 0 ? Math.round((number + Number.EPSILON) * 100) / 100 : null;
}

function headerName(value: unknown): string {
  return cellText(value);
}

function matchPriceField(header: string): keyof typeof PRICE_HEADER_ALIASES | null {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;
  for (const [field, aliases] of Object.entries(PRICE_HEADER_ALIASES) as Array<[keyof typeof PRICE_HEADER_ALIASES, string[]]>) {
    if (aliases.some((alias) => normalizeHeader(alias) === normalized)) return field;
  }
  return null;
}

type SpecGroup = {
  specIndex: number;
  specColumn: number | null;
  fields: Partial<Record<keyof typeof PRICE_HEADER_ALIASES, number>>;
};

function specIndexFromHeader(header: string): number | null {
  const match = header.trim().match(SPEC_HEADER);
  return match ? Number(match[1]) : null;
}

function buildSpecGroups(headers: unknown[]): SpecGroup[] | null {
  const names = headers.map((header) => headerName(header));
  const brandIndex = headerIndex(names, ['品牌', '厂家', '厂牌', 'brand']);
  const nameIndex = headerIndex(names, ['商品名', '名称', '产品名称', '产品名', '品名', 'name', 'productname', 'product']);
  const catalogIndex = headerIndex(names, ['货号', '产品货号', 'catalognumber', 'catalogno', 'catno', 'sku']);
  if (catalogIndex < 0) return null;

  const specStarts: Array<{ index: number; column: number }> = [];
  names.forEach((name, column) => {
    const specIndex = specIndexFromHeader(name);
    if (specIndex != null) specStarts.push({ index: specIndex, column });
  });

  const groups: SpecGroup[] = [{ specIndex: 1, specColumn: null, fields: {} }];
  const firstSpecColumn = specStarts[0]?.column ?? names.length;
  for (let column = Math.max(catalogIndex, brandIndex, nameIndex) + 1; column < firstSpecColumn; column += 1) {
    const field = matchPriceField(names[column] ?? '');
    if (field && groups[0].fields[field] == null) groups[0].fields[field] = column;
  }

  for (let i = 0; i < specStarts.length; i += 1) {
    const start = specStarts[i];
    const end = specStarts[i + 1]?.column ?? names.length;
    const group: SpecGroup = { specIndex: start.index, specColumn: start.column, fields: {} };
    for (let column = start.column + 1; column < end; column += 1) {
      const field = matchPriceField(names[column] ?? '');
      if (field && group.fields[field] == null) group.fields[field] = column;
    }
    groups.push(group);
  }

  return groups;
}

function pricesFromRow(row: unknown[], group: SpecGroup) {
  return {
    originalPrice: group.fields.originalPrice != null ? parseImportPrice(row[group.fields.originalPrice]) : null,
    price: group.fields.price != null ? parseImportPrice(row[group.fields.price]) : null,
    promotionalPrice: group.fields.promotionalPrice != null ? parseImportPrice(row[group.fields.promotionalPrice]) : null,
    costPrice: group.fields.costPrice != null ? parseImportPrice(row[group.fields.costPrice]) : null,
    minimumSalePrice: group.fields.minimumSalePrice != null ? parseImportPrice(row[group.fields.minimumSalePrice]) : null,
  };
}

function hasAnyPrice(prices: ReturnType<typeof pricesFromRow>): boolean {
  return Object.values(prices).some((value) => value != null);
}

export function importedRowHasFilePrices(row: Pick<ImportedAdjustmentRow, 'originalPrice' | 'price' | 'promotionalPrice' | 'costPrice' | 'minimumSalePrice'>): boolean {
  return hasAnyPrice(row);
}

export function toCatalogMatchItem(row: Pick<ImportedAdjustmentRow, 'catalogNumber' | 'spec' | 'brand'>): {
  catalogNumber: string;
  spec?: string;
  brand?: string;
} {
  return {
    catalogNumber: row.catalogNumber,
    ...(row.spec.trim() ? { spec: row.spec } : {}),
    ...(row.brand.trim() ? { brand: row.brand } : {}),
  };
}

export function toCatalogPriceItem(row: ImportedAdjustmentRow): CatalogPriceItem {
  return {
    catalogNumber: row.catalogNumber,
    ...(row.spec.trim() ? { spec: row.spec } : {}),
    ...(row.brand.trim() ? { brand: row.brand } : {}),
    ...(row.originalPrice != null ? { originalPrice: row.originalPrice } : {}),
    ...(row.price != null ? { price: row.price } : {}),
    ...(row.promotionalPrice != null ? { promotionalPrice: row.promotionalPrice } : {}),
    ...(row.costPrice != null ? { costPrice: row.costPrice } : {}),
    ...(row.minimumSalePrice != null ? { minimumSalePrice: row.minimumSalePrice } : {}),
  };
}

export function parsePricingAdjustmentImport(
  rows: unknown[][],
  options: { selectedBrand?: string; maxRows?: number } = {},
): { ok: true; rows: ImportedAdjustmentRow[]; wide: boolean } | { ok: false; error: string } {
  const selectedBrand = (options.selectedBrand ?? '').trim();
  const maxRows = options.maxRows ?? MAX_PRICE_ADJUSTMENT_CATALOGS;
  const table = rows.filter((row) => Array.isArray(row) && row.some((cell) => cellText(cell) !== ''));
  if (table.length === 0) return { ok: false, error: '表格没有数据。' };

  const headers = table[0] ?? [];
  const groups = buildSpecGroups(headers);
  if (!groups) return { ok: false, error: '未识别到“货号”列，请使用导入模板。' };

  const names = headers.map((header) => headerName(header));
  const brandIndex = headerIndex(names, ['品牌', '厂家', '厂牌', 'brand']);
  const nameIndex = headerIndex(names, ['商品名', '名称', '产品名称', '产品名', '品名', 'name', 'productname', 'product']);
  const catalogIndex = headerIndex(names, ['货号', '产品货号', 'catalognumber', 'catalogno', 'catno', 'sku']);
  const wide = groups.length > 1 || Boolean(groups[0]?.fields.originalPrice != null && groups[0]?.fields.price != null);

  const body = table.slice(1);
  if (body.length === 0) return { ok: false, error: '表格没有数据。' };

  const imported: ImportedAdjustmentRow[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < body.length; index += 1) {
    const row = body[index] ?? [];
    const excelRow = index + 2;
    const brandCell = brandIndex >= 0 ? cellText(row[brandIndex]) : '';
    const nameCell = nameIndex >= 0 ? cellText(row[nameIndex]) : '';
    const catalogNumber = catalogIndex >= 0 ? cellText(row[catalogIndex]) : '';
    const brandMatchesSelected = Boolean(brandCell && selectedBrand && normalizeLabel(brandCell) === normalizeLabel(selectedBrand));
    const brand = selectedBrand
      ? (brandMatchesSelected ? brandCell : selectedBrand)
      : brandCell;
    const name = nameCell || (selectedBrand && !brandMatchesSelected ? brandCell : '');

    for (const group of groups) {
      const spec = group.specColumn != null ? cellText(row[group.specColumn]) : '';
      const prices = pricesFromRow(row, group);
      const isPrimary = group.specIndex === 1 && group.specColumn == null;
      if (!isPrimary && !spec && !hasAnyPrice(prices)) continue;

      if (!catalogNumber) {
        if (!spec && !name && !hasAnyPrice(prices)) continue;
        imported.push({
          rowNumber: excelRow,
          brand,
          name,
          catalogNumber: '',
          spec,
          specIndex: group.specIndex,
          ...prices,
          status: 'invalid',
          note: '缺少货号',
        });
        continue;
      }
      if (!isPrimary && !spec) {
        imported.push({
          rowNumber: excelRow,
          brand,
          name,
          catalogNumber,
          spec: '',
          specIndex: group.specIndex,
          ...prices,
          status: 'invalid',
          note: `规格${group.specIndex}有价格但未填写规格`,
        });
        continue;
      }

      const key = `${normalizeCatalogNumber(catalogNumber)}::${normalizeCatalogNumber(spec)}`;
      if (seen.has(key)) {
        imported.push({
          rowNumber: excelRow,
          brand,
          name,
          catalogNumber,
          spec,
          specIndex: group.specIndex,
          ...prices,
          status: 'duplicate',
          note: '文件内重复',
        });
        continue;
      }
      seen.add(key);

      imported.push({
        rowNumber: excelRow,
        brand,
        name,
        catalogNumber,
        spec,
        specIndex: group.specIndex,
        ...prices,
        status: 'ready',
        note: '待核对货号',
      });
    }
  }

  if (imported.length === 0) return { ok: false, error: '表格没有可导入的货号。' };
  if (imported.length > maxRows) {
    return { ok: false, error: `单次最多导入 ${maxRows.toLocaleString('zh-CN')} 行，请拆分文件。` };
  }

  return { ok: true, rows: imported, wide };
}

export const CATALOG_NAME_REVIEW_PREFIX = '货号重合但商品不一致';
export const CATALOG_MANUAL_MATCH_PREFIX = '已匹配（人工确认）';
export const CATALOG_REVIEW_SKIPPED_NOTE = '已跳过，不改价';

export function catalogMatchKey(catalogNumber: string, spec: string): string {
  return `${normalizeCatalogNumber(catalogNumber)}::${normalizeCatalogNumber(spec)}`;
}

export function catalogNameReviewNote(productName: string): string {
  return productName ? `${CATALOG_NAME_REVIEW_PREFIX}（站内：${productName}）` : CATALOG_NAME_REVIEW_PREFIX;
}

export function catalogAmbiguousReviewNote(brands: string): string {
  return brands ? `货号对应多个商品（${brands}）` : '货号对应多个商品';
}

function candidateBrandsFromMatch(match: CatalogMatchResult): string[] {
  if (Array.isArray(match.candidateBrands) && match.candidateBrands.length > 0) {
    return [...new Set(match.candidateBrands.map((brand) => brand.trim()).filter(Boolean))];
  }
  return (match.productName || match.name || '')
    .split('、')
    .map((brand) => brand.trim())
    .filter(Boolean);
}

function matchProductName(match: CatalogMatchResult | undefined): string {
  if (match?.productName) return match.productName;
  const name = match?.name || '';
  const spec = match?.spec?.trim();
  if (spec) {
    const suffix = ` / ${spec}`;
    if (name.endsWith(suffix)) return name.slice(0, name.length - suffix.length);
  }
  return name;
}

export function importedRowIsMissing(row: ImportedAdjustmentRow): boolean {
  return row.status === 'invalid' && row.note === '未找到商品' && Boolean(row.catalogNumber.trim());
}

export function applyCatalogMatchResults(
  rows: ImportedAdjustmentRow[],
  matches: CatalogMatchResult[],
): ImportedAdjustmentRow[] {
  const byKey = new Map<string, CatalogMatchResult>();
  for (const match of matches) {
    byKey.set(catalogMatchKey(match.catalogNumber, match.spec), match);
  }
  return rows.map((row) => {
    if (row.status === 'duplicate' || row.status === 'review') return row;
    if (row.status === 'invalid' && !importedRowIsMissing(row)) return row;
    const match = byKey.get(catalogMatchKey(row.catalogNumber, row.spec));
    const siteName = matchProductName(match);
    if (match?.ambiguous) {
      const brands = candidateBrandsFromMatch(match);
      return {
        ...row,
        status: 'review',
        siteName: brands.join('、') || siteName,
        candidateBrands: brands,
        note: catalogAmbiguousReviewNote(brands.join('、') || siteName || match.name || ''),
      };
    }
    if (!match?.matched) {
      if (match?.nameConflict) {
        return {
          ...row,
          status: 'review',
          siteName,
          candidateBrands: [],
          note: catalogNameReviewNote(siteName),
        };
      }
      return { ...row, status: 'invalid', note: '未找到商品' };
    }
    const identity = assessImportedProductName(row.name, siteName, { brand: row.brand }).identity;
    if (identity === 'conflict') {
      return {
        ...row,
        status: 'review',
        siteName: siteName || match.name || '',
        candidateBrands: [],
        note: catalogNameReviewNote(siteName || match.name || ''),
      };
    }
    const nameHint = identity === 'keyword' || identity === 'similar' ? '（商品名部分一致）' : '';
    return {
      ...row,
      status: 'ready',
      siteName: siteName || undefined,
      note: match.name ? `已匹配：${match.name}${nameHint}` : `已匹配${nameHint}`,
    };
  });
}

export const DEFAULT_FILE_ADJUSTMENT_REASON = '按导入表格更新价格';

export function importedRowIsUsable(row: ImportedAdjustmentRow): boolean {
  return row.status === 'ready' || row.status === 'warning';
}

export function importedRowIsMatched(row: ImportedAdjustmentRow): boolean {
  return importedRowIsUsable(row) && row.note.startsWith('已匹配');
}

export function importedRowsNeedCatalogRematch(rows: ImportedAdjustmentRow[]): boolean {
  return rows.some((row) => importedRowIsMissing(row) || (importedRowIsUsable(row) && !importedRowIsMatched(row)));
}

export function importedRowNeedsReview(row: ImportedAdjustmentRow): boolean {
  return row.status === 'review';
}

export function reviewRowNeedsBrandChoice(row: ImportedAdjustmentRow): boolean {
  return importedRowNeedsReview(row) && (row.candidateBrands?.length ?? 0) > 1;
}

export function confirmImportedReviewRow(
  row: ImportedAdjustmentRow,
  options?: { brand?: string },
): ImportedAdjustmentRow {
  const brand = (options?.brand ?? row.brand).trim();
  const siteName = row.siteName?.trim() || '';
  return {
    ...row,
    brand: brand || row.brand,
    status: 'ready',
    note: siteName ? `${CATALOG_MANUAL_MATCH_PREFIX}：${siteName}` : CATALOG_MANUAL_MATCH_PREFIX,
  };
}

export function skipImportedReviewRow(row: ImportedAdjustmentRow): ImportedAdjustmentRow {
  return {
    ...row,
    status: 'invalid',
    note: CATALOG_REVIEW_SKIPPED_NOTE,
  };
}

export function applyImportedReviewDecision(
  rows: ImportedAdjustmentRow[],
  target: Pick<ImportedAdjustmentRow, 'catalogNumber' | 'spec' | 'rowNumber'>,
  decision: { action: 'confirm'; brand?: string } | { action: 'skip' },
): ImportedAdjustmentRow[] {
  return rows.map((row) => {
    if (!importedRowNeedsReview(row)) return row;
    if (row.rowNumber !== target.rowNumber) return row;
    if (normalizeCatalogNumber(row.catalogNumber) !== normalizeCatalogNumber(target.catalogNumber)) return row;
    if (normalizeCatalogNumber(row.spec) !== normalizeCatalogNumber(target.spec)) return row;
    if (decision.action === 'skip') return skipImportedReviewRow(row);
    return confirmImportedReviewRow(row, { brand: decision.brand });
  });
}

export function confirmNameConflictReviewRows(rows: ImportedAdjustmentRow[]): ImportedAdjustmentRow[] {
  return rows.map((row) => {
    if (!importedRowNeedsReview(row) || reviewRowNeedsBrandChoice(row)) return row;
    return confirmImportedReviewRow(row, { brand: row.candidateBrands?.[0] || row.brand });
  });
}

export type MissingCatalogDraft = {
  catalogNumber: string;
  name: string;
  spec: string;
  brand: string;
  originalPrice: number | null;
  price: number | null;
  promotionalPrice: number | null;
  costPrice: number | null;
  minimumSalePrice: number | null;
  variants: Array<{
    catalogNumber: string;
    spec: string;
    originalPrice: number | null;
    price: number | null;
    promotionalPrice: number | null;
    costPrice: number | null;
    minimumSalePrice: number | null;
  }>;
};

function variantCatalogNumber(parent: string, spec: string): string {
  const suffix = spec.replace(/\s+/g, '').replace(/[\\/]/g, '-');
  const catalog = `${parent}-${suffix}`;
  return catalog === parent ? `${parent}-pack` : catalog;
}

function pricesOf(row: ImportedAdjustmentRow) {
  return {
    originalPrice: row.originalPrice,
    price: row.price,
    promotionalPrice: row.promotionalPrice,
    costPrice: row.costPrice,
    minimumSalePrice: row.minimumSalePrice,
  };
}

export function groupMissingCatalogProducts(rows: ImportedAdjustmentRow[]): MissingCatalogDraft[] {
  const groups = new Map<string, ImportedAdjustmentRow[]>();
  for (const row of rows.filter(importedRowIsMissing)) {
    const key = normalizeCatalogNumber(row.catalogNumber);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  const drafts: MissingCatalogDraft[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((left, right) => left.specIndex - right.specIndex || left.rowNumber - right.rowNumber);
    const primary = sorted.find((row) => !row.spec.trim()) ?? sorted[0];
    if (!primary) continue;
    const variants = sorted
      .filter((row) => row !== primary && row.spec.trim())
      .map((row) => ({
        catalogNumber: variantCatalogNumber(primary.catalogNumber, row.spec),
        spec: row.spec.trim(),
        ...pricesOf(row),
      }));
    drafts.push({
      catalogNumber: primary.catalogNumber.trim(),
      name: primary.name.trim() || primary.catalogNumber.trim(),
      spec: primary.spec.trim(),
      brand: primary.brand.trim(),
      ...pricesOf(primary),
      variants,
    });
  }
  return drafts;
}

export function reopenMissingCatalogRows(rows: ImportedAdjustmentRow[], catalogNumbers: string[]): ImportedAdjustmentRow[] {
  const keys = new Set(catalogNumbers.map(normalizeCatalogNumber));
  return rows.map((row) => {
    if (!importedRowIsMissing(row) || !keys.has(normalizeCatalogNumber(row.catalogNumber))) return row;
    return { ...row, status: 'ready', note: '待核对货号' };
  });
}

export function summarizeImportedAdjustmentRows(rows: ImportedAdjustmentRow[]) {
  const unmatched = rows.filter((row) => row.status === 'invalid' && row.note === '未找到商品').length;
  const review = rows.filter(importedRowNeedsReview).length;
  return {
    total: rows.length,
    matched: rows.filter(importedRowIsMatched).length,
    pending: rows.filter((row) => importedRowIsUsable(row) && !row.note.startsWith('已匹配')).length,
    unmatched,
    review,
    invalid: rows.filter((row) => row.status === 'invalid').length - unmatched,
    duplicate: rows.filter((row) => row.status === 'duplicate').length,
    usable: rows.filter(importedRowIsUsable).length,
    pricedUsable: rows.filter((row) => importedRowIsUsable(row) && importedRowHasFilePrices(row)).length,
  };
}

export function getPricingPreviewReadiness(input: {
  brand: string;
  scope: 'category' | 'catalog';
  category: string;
  mode: 'percent' | 'amount' | 'set' | 'file';
  amount: string;
  reason: string;
  rows: ImportedAdjustmentRow[];
}): { ok: boolean; missing: string[]; effectiveReason: string; canWriteFromFile: boolean } {
  const stats = summarizeImportedAdjustmentRows(input.rows);
  const fileMode = input.mode === 'file';
  const numericAmount = Number(input.amount);
  const validAmount = fileMode || (input.amount.trim() !== '' && Number.isFinite(numericAmount) && numericAmount >= 0);
  const canWriteFromFile = input.scope === 'catalog' && stats.pricedUsable > 0;
  const scopeReady = input.scope === 'category' || stats.usable > 0;
  const effectiveReason = input.reason.trim() || (fileMode && canWriteFromFile ? DEFAULT_FILE_ADJUSTMENT_REASON : '');
  const missing = [
    fileMode && input.scope !== 'catalog' ? '导入货号表格' : '',
    fileMode && input.scope === 'catalog' && stats.pricedUsable === 0 ? '导入已匹配且含价格的货号' : '',
    input.scope === 'catalog' && stats.usable === 0 ? '导入已匹配货号' : '',
    !fileMode && !validAmount ? '填写调价数值' : '',
    effectiveReason.length < 2 ? '填写调价原因' : '',
  ].filter(Boolean);
  return {
    ok: scopeReady && effectiveReason.length >= 2 && (fileMode ? canWriteFromFile : validAmount),
    missing,
    effectiveReason,
    canWriteFromFile,
  };
}
