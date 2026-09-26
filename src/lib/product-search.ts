import type { Prisma } from '@prisma/client';
import { resolveDbBrandName } from '@/data/brands';
import { getSubcategoryQueryValues } from '@/data/category-aliases';
import { buildSubBrandWhere } from '@/lib/brand-sub-brands';
import { prisma } from '@/lib/prisma';
import { PRODUCT_ADMIN_LIST_SELECT, PRODUCT_LIST_SELECT } from '@/lib/prisma-selects';
import { STOREFRONT_HIDDEN_HAZARDOUS } from '@/lib/product-visibility';
import { createHash } from 'crypto';
import { getEphemeralStore, isRedisEphemeralStoreConfigured } from '@/lib/ephemeral-store';
import type { ProductSearchParams, ProductSearchResponse, ProductSearchSort } from '@/lib/product-search-contract';
import { mergeProductPackageOptions } from '@/lib/product-variants';
export type { ProductSearchParams, ProductSearchPagination, ProductSearchSort } from '@/lib/product-search-contract';

export type ProductSearchVariant = {
  id?: string;
  catalogNumber: string;
  spec: string | null;
  price: number;
};

export type ProductSearchItem = Omit<Prisma.ProductGetPayload<{ select: typeof PRODUCT_LIST_SELECT }>, 'applications' | 'reactivity'> & {
  applications: string[];
  reactivity: string[];
  variants?: ProductSearchVariant[];
};

export type AdminProductSearchItem = Omit<Prisma.ProductGetPayload<{ select: typeof PRODUCT_ADMIN_LIST_SELECT }>, 'applications' | 'reactivity'> & {
  applications: string[];
  reactivity: string[];
};

export type ProductSearchResult<T> = ProductSearchResponse<T>;

type SearchOptions = {
  scope?: 'storefront' | 'admin';
  deduplicateVariants?: boolean;
  maxLimit?: number;
  extraWhere?: Prisma.ProductWhereInput;
};

const VARIANT_BRANDS = new Set(['CST']);
const SEARCH_CACHE_TTL_MS = 30_000;

function normalizedList(values: readonly string[] | undefined): string[] {
  return [...new Set((values || []).map((value) => value.trim()).filter(Boolean))];
}

function safeStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function buildProductSearchWhere(
  params: ProductSearchParams,
  scope: 'storefront' | 'admin' = 'storefront',
): Prisma.ProductWhereInput {
  const keyword = params.keyword?.trim();
  const brands = normalizedList(params.brands).map(resolveDbBrandName);
  const applications = normalizedList(params.applications);
  const catalogNumbers = normalizedList(params.catalogNumbers);
  const hosts = normalizedList(params.hosts);
  const reactivities = normalizedList(params.reactivities);
  const speciesReactivities = normalizedList(params.speciesReactivities);
  const and: Prisma.ProductWhereInput[] = [];
  const where: Prisma.ProductWhereInput = {};

  if (keyword) {
    and.push({
      OR: [
        { name: { contains: keyword } },
        { catalogNumber: { contains: keyword } },
        { brand: { contains: keyword } },
        { category: { contains: keyword } },
        { target: { contains: keyword } },
        { applications: { contains: keyword } },
        { casNumber: { contains: keyword } },
      ],
    });
  }
  if (brands.length === 1) where.brand = brands[0];
  else if (brands.length > 1) where.brand = { in: brands };
  if (params.category?.trim()) where.category = params.category.trim();
  if (params.subcategory?.trim()) {
    const values = getSubcategoryQueryValues(params.subcategory.trim());
    where.subcategory = values.length === 1 ? values[0] : { in: values };
  }
  if (params.subBrand?.trim()) and.push(buildSubBrandWhere(params.subBrand.trim()) as Prisma.ProductWhereInput);
  if (params.target?.trim()) where.target = { contains: params.target.trim() };
  if (catalogNumbers.length === 1) where.catalogNumber = { contains: catalogNumbers[0] };
  else if (catalogNumbers.length > 1) where.catalogNumber = { in: catalogNumbers };
  if (hosts.length === 1) where.host = hosts[0];
  else if (hosts.length > 1) where.host = { in: hosts };
  if (applications.length) and.push({ OR: applications.map((application) => ({ applications: { contains: application } })) });
  if (reactivities.length) and.push({ OR: reactivities.map((reactivity) => ({ reactivity: { contains: reactivity } })) });
  if (speciesReactivities.length === 1) where.speciesReactivity = speciesReactivities[0];
  else if (speciesReactivities.length > 1) where.speciesReactivity = { in: speciesReactivities };
  if (params.productType?.trim()) {
    const productType = params.productType.trim();
    if (productType === '其它化合物') {
      and.push({ NOT: { OR: ['抑制剂', '拮抗剂', '激动剂'].flatMap((type) => [{ name: { contains: type } }, { type }]) } });
    } else {
      and.push({ OR: [{ type: productType }, { name: { contains: productType } }] });
    }
  }
  if (params.promotion) where.promotion = true;
  if (scope === 'storefront') Object.assign(where, STOREFRONT_HIDDEN_HAZARDOUS);
  if (and.length) where.AND = and;
  return where;
}

function searchOrder(sort: ProductSearchSort | undefined): Prisma.ProductOrderByWithRelationInput {
  if (sort === 'price-low') return { price: 'asc' };
  if (sort === 'price-high') return { price: 'desc' };
  if (sort === 'name') return { name: 'asc' };
  return { createdAt: 'desc' };
}

async function attachVariants(rows: Array<Prisma.ProductGetPayload<{ select: typeof PRODUCT_LIST_SELECT }>>) {
  const grouped = new Map<string, typeof rows[number]>();
  const deduplicated: typeof rows = [];
  for (const row of rows) {
    if (!VARIANT_BRANDS.has(row.brand)) {
      deduplicated.push(row);
      continue;
    }
    const baseSku = row.catalogNumber.replace(/[TSL]$/, '');
    const key = `${row.brand}:${baseSku}`;
    if (!grouped.has(key)) {
      grouped.set(key, row);
      deduplicated.push(row);
    }
  }

  const bases = [...new Set([...grouped.keys()].map((key) => key.slice(key.indexOf(':') + 1)))];
  const [cstVariants, packageVariants] = await Promise.all([
    bases.length
      ? prisma.product.findMany({
          where: {
            brand: { in: [...VARIANT_BRANDS] },
            catalogNumber: { in: bases.flatMap((base) => [`${base}T`, `${base}S`, `${base}L`]) },
            ...STOREFRONT_HIDDEN_HAZARDOUS,
          },
          select: { brand: true, catalogNumber: true, spec: true, price: true },
          orderBy: { catalogNumber: 'asc' },
        })
      : Promise.resolve([]),
    deduplicated.length
      ? prisma.productVariant.findMany({
          where: { productId: { in: deduplicated.map((row) => row.id) } },
          select: { id: true, productId: true, catalogNumber: true, spec: true, price: true },
          orderBy: [{ price: 'asc' }, { catalogNumber: 'asc' }],
        })
      : Promise.resolve([]),
  ]);

  const packageByProductId = new Map<string, ProductSearchVariant[]>();
  for (const variant of packageVariants) {
    const list = packageByProductId.get(variant.productId) ?? [];
    list.push({
      id: variant.id,
      catalogNumber: variant.catalogNumber,
      spec: variant.spec,
      price: variant.price,
    });
    packageByProductId.set(variant.productId, list);
  }

  return deduplicated.map((row) => {
    const packageList = packageByProductId.get(row.id) ?? [];
    if (packageList.length > 0) {
      const merged = mergeProductPackageOptions(row, packageList);
      return {
        ...row,
        applications: safeStringArray(row.applications),
        reactivity: safeStringArray(row.reactivity),
        ...(merged.length > 0 ? { variants: merged } : {}),
      };
    }

    const baseSku = row.catalogNumber.replace(/[TSL]$/, '');
    const matching = VARIANT_BRANDS.has(row.brand)
      ? cstVariants.filter((variant) => variant.brand === row.brand && variant.catalogNumber.replace(/[TSL]$/, '') === baseSku)
      : [];
    return {
      ...row,
      applications: safeStringArray(row.applications),
      reactivity: safeStringArray(row.reactivity),
      ...(matching.length > 1
        ? { variants: matching.map(({ catalogNumber, spec, price }) => ({ catalogNumber, spec, price })) }
        : {}),
    };
  });
}

export class ProductSearchService {
  static async search(params: ProductSearchParams, options: SearchOptions & { scope: 'admin' }): Promise<ProductSearchResult<AdminProductSearchItem>>;
  static async search(params: ProductSearchParams, options?: SearchOptions & { scope?: 'storefront' }): Promise<ProductSearchResult<ProductSearchItem>>;
  static async search(params: ProductSearchParams, options: SearchOptions = {}): Promise<ProductSearchResult<ProductSearchItem | AdminProductSearchItem>> {
    const scope = options.scope || 'storefront';
    const maxLimit = options.maxLimit || (scope === 'admin' ? 1000 : 100);
    const page = Math.max(Math.floor(params.page || 1), 1);
    const limit = Math.min(Math.max(Math.floor(params.limit || 12), 1), maxLimit);
    const cacheKey = scope === 'storefront' && isRedisEphemeralStoreConfigured()
      ? `product-search:${createHash('sha256').update(JSON.stringify({ ...params, page, limit })).digest('hex')}`
      : null;
    if (cacheKey) {
      try {
        const cached = await getEphemeralStore().get(cacheKey);
        if (cached) return JSON.parse(cached) as ProductSearchResult<ProductSearchItem>;
      } catch (error) {
        console.error('[product search cache read]', error);
      }
    }
    const baseWhere = buildProductSearchWhere(params, scope);
    const where: Prisma.ProductWhereInput = options.extraWhere ? { AND: [baseWhere, options.extraWhere] } : baseWhere;
    if (scope === 'admin') {
      const [rows, total] = await Promise.all([
        prisma.product.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: searchOrder(params.sort), select: PRODUCT_ADMIN_LIST_SELECT }),
        prisma.product.count({ where }),
      ]);
      return {
        products: rows.map((row) => ({ ...row, applications: safeStringArray(row.applications), reactivity: safeStringArray(row.reactivity) })),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    }

    const [rows, total] = await Promise.all([
      prisma.product.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: searchOrder(params.sort), select: PRODUCT_LIST_SELECT }),
      prisma.product.count({ where }),
    ]);
    const products = options.deduplicateVariants === false
      ? rows.map((row) => ({ ...row, applications: safeStringArray(row.applications), reactivity: safeStringArray(row.reactivity) }))
      : await attachVariants(rows);

    const result = { products, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    if (cacheKey) {
      try {
        await getEphemeralStore().set(cacheKey, JSON.stringify(result), SEARCH_CACHE_TTL_MS);
      } catch (error) {
        console.error('[product search cache write]', error);
      }
    }
    return result;
  }
}

function splitParam(value: string | null): string[] {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

export function productSearchParamsFromUrl(searchParams: URLSearchParams): ProductSearchParams {
  const sort = searchParams.get('sort');
  return {
    keyword: searchParams.get('search') || undefined,
    brands: splitParam(searchParams.get('brand')),
    category: searchParams.get('category') || undefined,
    subcategory: searchParams.get('sub') || undefined,
    subBrand: searchParams.get('subBrand') || undefined,
    target: searchParams.get('target') || undefined,
    applications: splitParam(searchParams.get('application')),
    catalogNumbers: splitParam(searchParams.get('catalogNumber')),
    hosts: splitParam(searchParams.get('host')),
    reactivities: splitParam(searchParams.get('reactivity')),
    speciesReactivities: splitParam(searchParams.get('species')),
    productType: searchParams.get('type') || undefined,
    promotion: searchParams.get('promotion') === 'true',
    sort: sort === 'price-low' || sort === 'price-high' || sort === 'name' || sort === 'newest' ? sort : 'relevance',
    page: Number(searchParams.get('page') || 1),
    limit: Number(searchParams.get('limit') || 12),
  };
}
