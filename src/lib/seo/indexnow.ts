import { prisma } from '@/lib/prisma';
import { productCanonicalUrl, STOREFRONT_SITEMAP_PRODUCT_WHERE } from '@/lib/seo/public-urls';
import { canonicalSiteUrl, getCanonicalSiteOrigin, isPublicHttpOrigin } from '@/lib/site-url';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_KEY_PATH = '/indexnow-key.txt';

export function getIndexNowKeyFilePath(key = getIndexNowKey()): string {
  return key ? `/${key}.txt` : INDEXNOW_KEY_PATH;
}
export const INDEXNOW_MAX_URLS_PER_REQUEST = 10_000;
export const INDEXNOW_BING_SITEMAP_PING = 'https://www.bing.com/ping';

const INDEXNOW_KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

export function getIndexNowKey(): string | null {
  const key = process.env.INDEXNOW_KEY?.trim() ?? '';
  return INDEXNOW_KEY_PATTERN.test(key) ? key : null;
}

export function getIndexNowKeyLocation(): string {
  return canonicalSiteUrl(getIndexNowKeyFilePath());
}

export function filterIndexNowUrls(urls: string[], origin = getCanonicalSiteOrigin()): string[] {
  const seen = new Set<string>();
  const allowed = new Set<string>();
  for (const raw of urls) {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    try {
      const url = new URL(trimmed);
      if (url.origin !== origin) continue;
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      allowed.add(url.toString());
    } catch {
      continue;
    }
  }
  return [...allowed];
}

export async function listRecentlyUpdatedStorefrontUrls(since: Date, limit = INDEXNOW_MAX_URLS_PER_REQUEST): Promise<string[]> {
  const rows = await prisma.product.findMany({
    where: {
      ...STOREFRONT_SITEMAP_PRODUCT_WHERE,
      updatedAt: { gte: since },
    },
    select: { catalogNumber: true, brand: true },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const row of rows) {
    const loc = productCanonicalUrl(row.catalogNumber, row.brand);
    if (seen.has(loc)) continue;
    seen.add(loc);
    urls.push(loc);
  }
  return urls;
}

export type IndexNowSubmitResult = {
  submitted: number;
  batches: number;
  skipped?: string;
  error?: string;
};

export async function submitIndexNowUrls(
  urls: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<IndexNowSubmitResult> {
  const key = getIndexNowKey();
  if (!key) return { submitted: 0, batches: 0, skipped: 'indexnow_unconfigured' };

  const origin = getCanonicalSiteOrigin();
  if (!isPublicHttpOrigin(origin)) {
    return { submitted: 0, batches: 0, skipped: 'non_public_origin' };
  }

  const host = new URL(origin).host;
  const filtered = filterIndexNowUrls(urls, origin);
  if (filtered.length === 0) return { submitted: 0, batches: 0 };

  const keyLocation = getIndexNowKeyLocation();
  let submitted = 0;
  let batches = 0;

  for (let offset = 0; offset < filtered.length; offset += INDEXNOW_MAX_URLS_PER_REQUEST) {
    const urlList = filtered.slice(offset, offset + INDEXNOW_MAX_URLS_PER_REQUEST);
    const response = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation, urlList }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 200 && response.status !== 202) {
      const detail = await response.text().catch(() => '');
      return {
        submitted,
        batches,
        error: `indexnow_http_${response.status}${detail ? `:${detail.slice(0, 200)}` : ''}`,
      };
    }
    submitted += urlList.length;
    batches += 1;
  }

  return { submitted, batches };
}

export async function pingBingSitemap(
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const origin = getCanonicalSiteOrigin();
  if (!isPublicHttpOrigin(origin)) return { ok: false, skipped: 'non_public_origin' };

  const sitemap = canonicalSiteUrl('/sitemap.xml');
  const pingUrl = `${INDEXNOW_BING_SITEMAP_PING}?sitemap=${encodeURIComponent(sitemap)}`;
  const response = await fetchImpl(pingUrl, { method: 'GET', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    return { ok: false, error: `bing_sitemap_ping_${response.status}` };
  }
  return { ok: true };
}
