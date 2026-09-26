import type { PrismaClient } from '@prisma/client';
import { resolveDbBrandName } from '@/data/brands';

/** 历史脏键 / 展示名 → 产品库可能出现的标准名（按优先级尝试） */
const DISCOUNT_BRAND_ALIASES: Record<string, string[]> = {
  fisher: ['Fisher BioReagents', 'Thermo Fisher > Fisher BioReagents', 'Fisher'],
  'fisher bioreagents': ['Fisher BioReagents', 'Thermo Fisher > Fisher BioReagents'],
  'cell signaling technology': ['CST'],
  cst: ['CST'],
  invariant: ['Invariant'],
  'thermo fisher > invariant': ['Thermo Fisher > Invariant'],
  biossharp: ['Biosharp'],
};

export type AlignBrandDiscountsResult = {
  aligned: Record<string, number>;
  unmapped: string[];
  renames: { from: string; to: string }[];
};

export function normalizeBrandToken(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function brandMatchKey(value: string): string {
  return normalizeBrandToken(value).toLowerCase();
}

export function formatBrandDiscountKey(brand: string, subBrand?: string | null): string {
  const b = normalizeBrandToken(brand);
  const s = subBrand ? normalizeBrandToken(subBrand) : '';
  return s ? `${b} > ${s}` : b;
}

export async function loadCatalogBrandKeys(
  db: Pick<PrismaClient, 'product'>,
): Promise<string[]> {
  const [brands, pairs] = await Promise.all([
    db.product.findMany({
      distinct: ['brand'],
      select: { brand: true },
      orderBy: { brand: 'asc' },
    }),
    db.product.groupBy({
      by: ['brand', 'subBrand'],
      where: { subBrand: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of brands) {
    const key = normalizeBrandToken(row.brand);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  const composite = pairs
    .filter((row) => row.subBrand && String(row.subBrand).trim())
    .map((row) => formatBrandDiscountKey(row.brand, row.subBrand))
    .sort((a, b) => a.localeCompare(b, 'en'));

  for (const key of composite) {
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  return keys;
}

function buildCatalogIndex(catalogKeys: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const key of catalogKeys) {
    index.set(brandMatchKey(key), key);
  }
  return index;
}

/**
 * 将任意品牌键解析为产品库标准键；无法对齐时返回 null。
 */
export function resolveCatalogBrandKey(
  raw: string,
  catalogKeys: string[],
  catalogIndex?: Map<string, string>,
): string | null {
  const token = normalizeBrandToken(raw);
  if (!token) return null;

  const index = catalogIndex ?? buildCatalogIndex(catalogKeys);

  if (catalogKeys.includes(token)) return token;

  const folded = brandMatchKey(token);
  const byCase = index.get(folded);
  if (byCase) return byCase;

  const dbName = normalizeBrandToken(resolveDbBrandName(token));
  if (dbName !== token) {
    if (catalogKeys.includes(dbName)) return dbName;
    const dbHit = index.get(brandMatchKey(dbName));
    if (dbHit) return dbHit;
  }

  for (const [alias, targets] of Object.entries(DISCOUNT_BRAND_ALIASES)) {
    if (folded === alias || folded.endsWith(` > ${alias}`)) {
      for (const target of targets) {
        if (catalogKeys.includes(target)) return target;
        const hit = index.get(brandMatchKey(target));
        if (hit) return hit;
      }
    }
  }

  const sep = ' > ';
  const sepIdx = token.indexOf(sep);
  if (sepIdx > 0) {
    const left = token.slice(0, sepIdx);
    const right = token.slice(sepIdx + sep.length);
    const leftResolved = resolveCatalogBrandKey(left, catalogKeys, index) ?? left;
    const rightNorm = normalizeBrandToken(right);
    const compositeCandidates = catalogKeys.filter((k) => k.startsWith(`${leftResolved} > `));
    for (const candidate of compositeCandidates) {
      const sub = candidate.slice(leftResolved.length + sep.length);
      if (brandMatchKey(sub) === brandMatchKey(rightNorm)) return candidate;
    }
    const composed = formatBrandDiscountKey(leftResolved, rightNorm);
    if (catalogKeys.includes(composed)) return composed;
    const composedHit = index.get(brandMatchKey(composed));
    if (composedHit) return composedHit;
  }

  return null;
}

function preferRate(a: number, b: number): number {
  if (!(a > 0)) return b;
  if (!(b > 0)) return a;
  return Math.min(a, b);
}

export function alignBrandDiscounts(
  input: Record<string, number> | null | undefined,
  catalogKeys: string[],
): AlignBrandDiscountsResult {
  const aligned: Record<string, number> = {};
  const unmapped: string[] = [];
  const renames: { from: string; to: string }[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { aligned, unmapped, renames };
  }

  const index = buildCatalogIndex(catalogKeys);
  for (const [rawKey, rate] of Object.entries(input)) {
    if (typeof rate !== 'number' || Number.isNaN(rate)) {
      unmapped.push(rawKey);
      continue;
    }
    const resolved = resolveCatalogBrandKey(rawKey, catalogKeys, index);
    if (!resolved) {
      unmapped.push(rawKey);
      continue;
    }
    if (resolved !== rawKey) {
      renames.push({ from: rawKey, to: resolved });
    }
    aligned[resolved] = aligned[resolved] != null
      ? preferRate(aligned[resolved], rate)
      : rate;
  }

  return { aligned, unmapped, renames };
}

export function parseBrandDiscountsJson(value: unknown): Record<string, number> | null {
  if (value == null || value === '') return null;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'number' && !Number.isNaN(v)) out[k] = v;
  }
  return out;
}

export function serializeBrandDiscounts(map: Record<string, number>): string {
  return Object.keys(map).length > 0 ? JSON.stringify(map) : '{}';
}

/** 计价查找：精确键优先，再按归一键匹配 map 中的键 */
export function lookupBrandDiscountRate(
  brandMap: Record<string, number>,
  brand: string,
  subBrand?: string | null,
): number | null {
  if (subBrand) {
    const subKey = formatBrandDiscountKey(brand, subBrand);
    if (brandMap[subKey] != null) return brandMap[subKey];
    const subFold = brandMatchKey(subKey);
    for (const [k, v] of Object.entries(brandMap)) {
      if (brandMatchKey(k) === subFold) return v;
    }
  }

  if (brandMap[brand] != null) return brandMap[brand];
  const brandFold = brandMatchKey(brand);
  for (const [k, v] of Object.entries(brandMap)) {
    if (!k.includes(' > ') && brandMatchKey(k) === brandFold) return v;
  }
  const dbName = resolveDbBrandName(brand);
  if (dbName !== brand && brandMap[dbName] != null) return brandMap[dbName];
  for (const [k, v] of Object.entries(brandMap)) {
    if (!k.includes(' > ') && brandMatchKey(k) === brandMatchKey(dbName)) return v;
  }

  return null;
}
