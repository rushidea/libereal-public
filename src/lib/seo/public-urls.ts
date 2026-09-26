import type { Prisma } from '@prisma/client';
import { brandPageHref, resolveDbBrandName } from '@/data/brands';
import { STOREFRONT_HIDDEN_HAZARDOUS } from '@/lib/product-visibility';
import { canonicalSiteUrl, getCanonicalSiteOrigin } from '@/lib/site-url';

export const SITEMAP_URL_LIMIT = 40_000;
export const SITEMAP_SEARCH_ENGINE_URL_LIMIT = 50_000;
export const SITEMAP_UNCOMPRESSED_BYTE_LIMIT = 50 * 1024 * 1024;

export function isCanonicalSitemapUrl(loc: string): boolean {
  try {
    return new URL(loc).origin === getCanonicalSiteOrigin();
  } catch {
    return false;
  }
}

/** Same visibility as product detail: non-hazardous rows that can build a catalog+brand URL. */
export const STOREFRONT_SITEMAP_PRODUCT_WHERE: Prisma.ProductWhereInput = {
  ...STOREFRONT_HIDDEN_HAZARDOUS,
  catalogNumber: { not: '' },
  brand: { not: '' },
  name: { not: '' },
};

export function productCanonicalPath(catalogNumber: string, brand: string): string {
  const canonicalBrand = resolveDbBrandName(brand);
  return `/products/${encodeURIComponent(catalogNumber)}?brand=${encodeURIComponent(canonicalBrand)}`;
}

export function productCanonicalUrl(catalogNumber: string, brand: string): string {
  return canonicalSiteUrl(productCanonicalPath(catalogNumber, brand));
}

export function brandCanonicalPath(dbBrand: string): string {
  return brandPageHref(resolveDbBrandName(dbBrand));
}

export function isPrivateSeoPath(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? pathname;
  return (
    path.startsWith('/api/') ||
    path.startsWith('/admin') ||
    path.startsWith('/account') ||
    path.startsWith('/login') ||
    path.startsWith('/register') ||
    path.startsWith('/cart') ||
    path.startsWith('/order') ||
    path.startsWith('/ord') ||
    path.startsWith('/checkout') ||
    path.startsWith('/inquiry') ||
    path.startsWith('/forgot-password') ||
    path.startsWith('/reset-password') ||
    path.startsWith('/protocols/user/') ||
    path.startsWith('/protocols/buffers/user/')
  );
}

export const STATIC_SITEMAP_PATHS = [
  '/',
  '/products',
  '/products/catalog',
  '/brands',
  '/research-tools',
  '/resources',
  '/academic-support',
  '/scenes',
  '/support',
  '/help',
  '/faq',
  '/discoveries',
  '/discoveries/articles',
  '/protocols',
  '/about',
  '/updates',
  '/contact',
  '/legal',
  '/legal/sales-terms',
  '/privacy',
  '/terms',
  '/cookies',
  '/promise',
] as const;
