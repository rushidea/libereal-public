import { filterIndexNowUrls } from '@/lib/seo/indexnow';
import { getCanonicalSiteOrigin, isPublicHttpOrigin } from '@/lib/site-url';

export const BAIDU_PUSH_ENDPOINT = 'http://data.zz.baidu.com/urls';
/** Baidu active push accepts up to 2000 URLs per request. */
export const BAIDU_PUSH_MAX_URLS_PER_REQUEST = 2000;

export type BaiduPushConfig = {
  site: string;
  token: string;
};

/** Baidu `site` query param is the verified host, e.g. `libereal.cn`. Scheme URLs return `site init fail`. */
export function normalizeBaiduPushSite(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  try {
    const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).host;
  } catch {
    return trimmed.replace(/\/$/, '');
  }
}

export function getBaiduPushConfig(): BaiduPushConfig | null {
  const token = process.env.BAIDU_PUSH_TOKEN?.trim() ?? '';
  if (!token) return null;
  const site = normalizeBaiduPushSite(process.env.BAIDU_PUSH_SITE?.trim() || getCanonicalSiteOrigin());
  return { site, token };
}

export type BaiduPushResult = {
  submitted: number;
  batches: number;
  success?: number;
  remain?: number;
  notSameSite?: string[];
  notValid?: string[];
  skipped?: string;
  error?: string;
};

type BaiduPushResponse = {
  success?: number;
  remain?: number;
  not_same_site?: string[];
  not_valid?: string[];
};

export async function submitBaiduPushUrls(
  urls: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<BaiduPushResult> {
  const config = getBaiduPushConfig();
  if (!config) return { submitted: 0, batches: 0, skipped: 'baidu_push_unconfigured' };

  const origin = getCanonicalSiteOrigin();
  if (!isPublicHttpOrigin(origin)) {
    return { submitted: 0, batches: 0, skipped: 'non_public_origin' };
  }

  const filtered = filterIndexNowUrls(urls, origin);
  if (filtered.length === 0) return { submitted: 0, batches: 0 };

  const endpoint =
    `${BAIDU_PUSH_ENDPOINT}?site=${encodeURIComponent(config.site)}&token=${encodeURIComponent(config.token)}`;

  let submitted = 0;
  let batches = 0;
  let success = 0;
  let remain: number | undefined;
  const notSameSite: string[] = [];
  const notValid: string[] = [];

  for (let offset = 0; offset < filtered.length; offset += BAIDU_PUSH_MAX_URLS_PER_REQUEST) {
    const batch = filtered.slice(offset, offset + BAIDU_PUSH_MAX_URLS_PER_REQUEST);
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: batch.join('\n'),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text().catch(() => '');
    if (response.status !== 200) {
      return {
        submitted,
        batches,
        error: `baidu_push_http_${response.status}${text ? `:${text.slice(0, 200)}` : ''}`,
      };
    }

    let parsed: BaiduPushResponse;
    try {
      parsed = JSON.parse(text) as BaiduPushResponse;
    } catch {
      return { submitted, batches, error: `baidu_push_invalid_json:${text.slice(0, 200)}` };
    }

    success += parsed.success ?? 0;
    if (typeof parsed.remain === 'number') remain = parsed.remain;
    if (parsed.not_same_site?.length) notSameSite.push(...parsed.not_same_site);
    if (parsed.not_valid?.length) notValid.push(...parsed.not_valid);
    submitted += batch.length;
    batches += 1;
  }

  return {
    submitted,
    batches,
    success,
    ...(remain !== undefined ? { remain } : {}),
    ...(notSameSite.length ? { notSameSite } : {}),
    ...(notValid.length ? { notValid } : {}),
  };
}
