import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { normalizeRouteRegex } from 'next/dist/lib/load-custom-routes';
import nextConfig from '../../next.config';

type PathToRegexp = (
  path: string,
  keys: unknown[],
  options: { strict: boolean; sensitive: boolean; delimiter: string },
) => { source: string };

const { pathToRegexp } = createRequire(import.meta.url)('next/dist/compiled/path-to-regexp') as {
  pathToRegexp: PathToRegexp;
};

const PUBLIC_ASSET_CACHE = 'public, max-age=86400, stale-while-revalidate=604800';
const NO_STORE = 'no-store, must-revalidate';

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

/**
 * Same compilation Next uses for next.config headers(): path-to-regexp with
 * strict matching, then later rules overwrite the same header key.
 */
function cacheControlFor(pathname: string, rules: HeaderRule[]): string | undefined {
  let value: string | undefined;
  for (const rule of rules) {
    const compiled = pathToRegexp(rule.source, [], {
      strict: true,
      sensitive: false,
      delimiter: '/',
    });
    const regex = new RegExp(normalizeRouteRegex(compiled.source));
    if (!regex.test(pathname)) continue;
    const header = rule.headers.find((item) => item.key.toLowerCase() === 'cache-control');
    if (header) value = header.value;
  }
  return value;
}

describe('next.config Cache-Control', () => {
  it('keeps dynamic pages and APIs non-cacheable and lets hashed assets use Next defaults', async () => {
    const rules = (await nextConfig.headers?.()) as HeaderRule[];
    expect(rules.some((rule) => rule.source.startsWith('/_next/'))).toBe(false);

    const header = (pathname: string) => cacheControlFor(pathname, rules);

    expect(header('/')).toBeUndefined();
    expect(header('/products/9272S')).toBe(NO_STORE);
    expect(header('/login')).toBe(NO_STORE);
    expect(header('/login/mfa')).toBe(NO_STORE);
    expect(header('/account')).toBe(NO_STORE);
    expect(header('/account/orders')).toBe(NO_STORE);
    expect(header('/account/points')).toBe(NO_STORE);
    expect(header('/admin')).toBe(NO_STORE);
    expect(header('/admin/orders')).toBe(NO_STORE);
    expect(header('/api/orders')).toBe(NO_STORE);
    expect(header('/api/auth/session')).toBe(NO_STORE);
    expect(header('/api/admin/users')).toBe(NO_STORE);
    expect(header('/cart')).toBe(NO_STORE);
    expect(header('/checkout/address')).toBe(NO_STORE);
    expect(header('/theme-init.js')).toBe(NO_STORE);
    expect(header('/_next/data/build/index.json')).toBe(NO_STORE);

    // Omitted on purpose. Production Next sets public, max-age=31536000, immutable
    // only when no Cache-Control is already present. /_next/image sets its own TTL.
    expect(header('/_next/static/chunks/main-abc.js')).toBeUndefined();
    expect(header('/_next/static/css/app.css')).toBeUndefined();
    expect(header('/_next/static/media/font.woff2')).toBeUndefined();
    expect(header('/_next/image')).toBeUndefined();

    expect(header('/images/home/hero.webp')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/images/scenes/lab.png')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/images/products/sku.avif')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/fonts/Library3AM.otf')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/brand/libereal-mail-logo.svg')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/video/intro.mp4')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/video/promotions/clip.mp4')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/wechat/articles/cover.png')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/favicon.ico')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/favicon.png')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/og-image.jpg')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/libereal-wordmark.svg')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/brand-logo-email.png')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/brand-logo-transparent.png')).toBe(PUBLIC_ASSET_CACHE);
    expect(header('/footer-logo.png')).toBe(PUBLIC_ASSET_CACHE);

    expect(header('/brands')).toBe(NO_STORE);
    expect(header('/brands/biosharp')).toBe(NO_STORE);

    expect(header('/sitemap.xml')).toBe('public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    expect(header('/sitemaps/products.xml')).toBe('public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    expect(header('/robots.txt')).toBe('public, max-age=300, s-maxage=3600');
  });
});
