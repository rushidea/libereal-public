import { unstable_cache, revalidateTag } from 'next/cache';
import {
  aggregateAliasedSubcategoryCounts,
  getSubcategoryQueryValues,
} from '@/data/category-aliases';
import { prisma } from '@/lib/prisma';
import {
  mergeBrandSubBrands,
} from '@/lib/brand-sub-brands';
import { STOREFRONT_HIDDEN_HAZARDOUS } from '@/lib/product-visibility';
import { getBrandInfo } from '@/data/brands';

/** Host species names are Latin (Rabbit, Mouse, Human). Reject discount labels like "6折". */
export function isValidHostSpecies(host: string): boolean {
  const trimmed = host.trim();
  if (!trimmed) return false;
  if (/折/.test(trimmed)) return false;
  return /^[A-Za-z][A-Za-z\s/-]*$/.test(trimmed);
}

/** Reject pure numbers, discount strings, and too-short garbage in application facets. */
export function isValidApplication(app: string): boolean {
  const trimmed = app.trim();
  if (!trimmed || trimmed.length < 2) return false;
  if (/^\d+$/.test(trimmed)) return false;
  if (/折/.test(trimmed)) return false;
  if (/^[\d.%]+$/.test(trimmed)) return false;
  return true;
}

/** Reject pure numbers, discount strings, and too-short garbage in reactivity facets. */
export function isValidReactivity(reac: string): boolean {
  const trimmed = reac.trim();
  if (!trimmed || trimmed.length < 2) return false;
  if (/^\d+$/.test(trimmed)) return false;
  if (/折/.test(trimmed)) return false;
  return /^[A-Za-z]/.test(trimmed) || /[\u4e00-\u9fff]/.test(trimmed);
}

export interface FilterData {
  brands: string[];
  categories: string[];
  hosts: string[];
  applications: string[];
  reactivities: string[];
  speciesReactivities: string[];
  types: string[];
  brandCounts: Record<string, number>;
  brandSubBrands: Record<string, { name: string; count: number }[]>;
  subCounts?: Record<string, number>;
}

function scopeWhere(category?: string, sub?: string): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (sub) {
    const subcategoryValues = getSubcategoryQueryValues(sub);
    where.subcategory = subcategoryValues.length === 1 ? sub : { in: subcategoryValues };
  }
  // 危险化学品仅后台可见，分面计数只统计顾客端可展示商品
  Object.assign(where, STOREFRONT_HIDDEN_HAZARDOUS);
  return where;
}

async function buildFilterData(category?: string, sub?: string): Promise<FilterData> {
  const scope = scopeWhere(category, sub);

  const [brands, categories, hosts, products, brandSubBrandCounts, subCountsRaw, speciesRows, typeRows] = await Promise.all([
    prisma.product.findMany({
      select: { brand: true },
      distinct: ['brand'],
      where: { ...scope, brand: { not: '' } },
      orderBy: { brand: 'asc' },
    }),
    prisma.product.findMany({
      select: { category: true },
      distinct: ['category'],
      where: { category: { not: null }, ...STOREFRONT_HIDDEN_HAZARDOUS },
      orderBy: { category: 'asc' },
    }),
    prisma.product.findMany({
      select: { host: true },
      distinct: ['host'],
      where: { ...scope, host: { not: '' } },
      orderBy: { host: 'asc' },
    }),
    prisma.product.findMany({
      select: { applications: true, reactivity: true },
      where: scope,
    }),
    prisma.product.groupBy({
      by: ['brand', 'subBrand'],
      _count: { brand: true },
      where: { ...scope, brand: { not: '' } },
    }),
    category
      ? prisma.product.groupBy({
          by: ['subcategory'],
          _count: { subcategory: true },
          where: { category, subcategory: { not: null }, ...STOREFRONT_HIDDEN_HAZARDOUS },
        })
      : Promise.resolve([]),
    prisma.product.findMany({
      select: { speciesReactivity: true },
      distinct: ['speciesReactivity'],
      where: { ...scope, speciesReactivity: { not: null, notIn: [''] } },
      orderBy: { speciesReactivity: 'asc' },
    }),
    prisma.product.findMany({
      select: { type: true },
      distinct: ['type'],
      where: { ...scope, type: { not: null, notIn: [''] } },
      orderBy: { type: 'asc' },
    }),
  ]);

  const applicationsSet = new Set<string>();
  const reactivitySet = new Set<string>();

  products.forEach(p => {
    const apps = JSON.parse(p.applications) as string[];
    apps.forEach((a: string) => {
      const name = a.split(':')[0].trim();
      if (name && isValidApplication(name)) applicationsSet.add(name);
    });
    const reacs = JSON.parse(p.reactivity) as string[];
    reacs.forEach((r: string) => {
      r.split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
        if (isValidReactivity(s)) reactivitySet.add(s);
      });
    });
  });

  const brandCounts: Record<string, number> = {};
  const brandSubBrands: Record<string, { name: string; count: number }[]> = {};

  brandSubBrandCounts.forEach(item => {
    const count = item._count.brand;
    if (item.subBrand) {
      if (!brandSubBrands[item.brand]) {
        brandSubBrands[item.brand] = [];
      }
      brandSubBrands[item.brand].push({ name: item.subBrand, count });
    } else {
      brandCounts[item.brand] = (brandCounts[item.brand] || 0) + count;
    }
  });

  Object.keys(brandSubBrands).forEach(brand => {
    brandCounts[brand] = (brandCounts[brand] || 0) + brandSubBrands[brand].reduce((sum, sb) => sum + sb.count, 0);
  });

  for (const brand of Object.keys(brandSubBrands)) {
    if (getBrandInfo(brand)?.subBrands?.length) {
      brandSubBrands[brand] = mergeBrandSubBrands(brand, brandSubBrands[brand]);
    } else {
      brandSubBrands[brand].sort((a, b) => b.count - a.count);
    }
  }

  const subCounts: Record<string, number> = {};
  subCountsRaw.forEach(item => {
    if (item.subcategory) {
      subCounts[item.subcategory] = item._count.subcategory;
    }
  });
  const displaySubCounts = aggregateAliasedSubcategoryCounts(subCounts);

  return {
    brands: brands.map(b => b.brand).filter(Boolean),
    categories: categories.map(c => c.category).filter(Boolean) as string[],
    hosts: hosts
      .map(h => h.host)
      .filter((h): h is string => h != null && h !== '' && isValidHostSpecies(h)),
    applications: Array.from(applicationsSet).sort(),
    reactivities: Array.from(reactivitySet).sort(),
    speciesReactivities: speciesRows
      .map(s => s.speciesReactivity)
      .filter((s): s is string => s != null && s !== ''),
    types: typeRows
      .map(t => t.type)
      .filter((t): t is string => t != null && t !== ''),
    brandCounts,
    brandSubBrands,
    ...(category ? { subCounts: displaySubCounts } : {}),
  };
}

function getCachedFilters(category?: string, sub?: string) {
  return unstable_cache(
    () => buildFilterData(category, sub),
    ['product-filters-v8', category ?? '', sub ?? ''],
    { revalidate: 3600, tags: ['product-filters'] }
  );
}

export async function fetchProductFiltersCached(
  category?: string,
  sub?: string
): Promise<FilterData> {
  return getCachedFilters(category, sub)();
}

export function invalidateProductFilters(): void {
  revalidateTag('product-filters', 'max');
}
