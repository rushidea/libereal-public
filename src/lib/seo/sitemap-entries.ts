import { protocolSummaries } from '@/data/protocols-summary';
import { bufferSummaries } from '@/data/buffers-summary';
import { scenes } from '@/data/scenes';
import { getAllWechatArticleMetas } from '@/lib/wechat-articles';
import { prisma } from '@/lib/prisma';
import { canonicalSiteUrl } from '@/lib/site-url';
import {
  SITEMAP_URL_LIMIT,
  STATIC_SITEMAP_PATHS,
  STOREFRONT_SITEMAP_PRODUCT_WHERE,
  brandCanonicalPath,
  isCanonicalSitemapUrl,
  productCanonicalUrl,
} from '@/lib/seo/public-urls';
import type { SitemapUrlEntry } from '@/lib/seo/sitemap-xml';

async function countDistinctProductSitemapKeys(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint | number }>>`
    SELECT COUNT(*) AS n FROM (
      SELECT 1
      FROM Product
      WHERE hazardous = 0
        AND catalogNumber != ''
        AND brand != ''
        AND name != ''
      GROUP BY brand, catalogNumber
    )
  `;
  return Number(rows[0]?.n ?? 0);
}

export async function listProductSitemapShardIds(): Promise<string[]> {
  const total = await countDistinctProductSitemapKeys();
  const shardCount = Math.max(1, Math.ceil(total / SITEMAP_URL_LIMIT));
  return Array.from({ length: shardCount }, (_, index) => `products-${index}.xml`);
}

export async function listSitemapShardHrefs(): Promise<string[]> {
  const productShards = await listProductSitemapShardIds();
  return ['pages.xml', ...productShards].map((shard) => canonicalSiteUrl(`/sitemaps/${shard}`));
}

export async function buildPagesSitemapEntries(): Promise<SitemapUrlEntry[]> {
  const [brandGroups, articles] = await Promise.all([
    prisma.product.groupBy({
      by: ['brand'],
      where: STOREFRONT_SITEMAP_PRODUCT_WHERE,
      _max: { updatedAt: true },
    }),
    Promise.resolve(getAllWechatArticleMetas()),
  ]);

  const entries: SitemapUrlEntry[] = STATIC_SITEMAP_PATHS.map((path) => ({
    loc: canonicalSiteUrl(path),
  }));


  const brandLocs = new Map<string, Date | undefined>();
  for (const group of brandGroups) {
    const loc = canonicalSiteUrl(brandCanonicalPath(group.brand));
    const next = group._max.updatedAt ?? undefined;
    const prev = brandLocs.get(loc);
    if (!prev || (next && next > prev)) {
      brandLocs.set(loc, next);
    }
  }
  for (const [loc, lastModified] of brandLocs) {
    const existing = entries.find((entry) => entry.loc === loc);
    if (existing) existing.lastModified = lastModified;
    else entries.push({ loc, lastModified });
  }

  for (const scene of scenes) {
    entries.push({ loc: canonicalSiteUrl(`/scenes/${scene.slug}`) });
  }

  for (const article of articles) {
    entries.push({
      loc: canonicalSiteUrl(`/discoveries/${article.slug}`),
      lastModified: article.publishedDate ?? article.date,
    });
  }

  for (const protocol of protocolSummaries) {
    entries.push({ loc: canonicalSiteUrl(`/protocols/${protocol.id}`) });
  }

  for (const buffer of bufferSummaries) {
    entries.push({ loc: canonicalSiteUrl(`/protocols/buffers/${buffer.id}`) });
  }

  return entries.filter((entry) => isCanonicalSitemapUrl(entry.loc));
}

export async function buildProductSitemapEntries(shardIndex: number): Promise<SitemapUrlEntry[]> {
  const rows = await prisma.product.groupBy({
    by: ['brand', 'catalogNumber'],
    where: STOREFRONT_SITEMAP_PRODUCT_WHERE,
    _max: { updatedAt: true },
    orderBy: [{ brand: 'asc' }, { catalogNumber: 'asc' }],
    skip: shardIndex * SITEMAP_URL_LIMIT,
    take: SITEMAP_URL_LIMIT,
  });

  const seen = new Set<string>();
  const entries: SitemapUrlEntry[] = [];
  for (const row of rows) {
    const loc = productCanonicalUrl(row.catalogNumber, row.brand);
    if (seen.has(loc)) continue;
    seen.add(loc);
    entries.push({ loc, lastModified: row._max.updatedAt ?? undefined });
  }
  return entries;
}
