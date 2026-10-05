import { describe, expect, it } from 'vitest';
import {
  brandCanonicalPath,
  isCanonicalSitemapUrl,
  isPrivateSeoPath,
  productCanonicalPath,
  STATIC_SITEMAP_PATHS,
  STOREFRONT_SITEMAP_PRODUCT_WHERE,
} from '@/lib/seo/public-urls';
import { renderSitemapIndex, renderUrlset, SITEMAP_XML_HEADERS } from '@/lib/seo/sitemap-xml';
import { config as proxyConfig } from '@/proxy';

describe('public SEO URL rules', () => {
  it('builds canonical product paths with brand query and skips variants-only URLs', () => {
    expect(productCanonicalPath('9272S', 'CST')).toBe('/products/9272S?brand=CST');
  });

  it('maps brand aliases onto the same canonical brand and product URLs', () => {
    expect(brandCanonicalPath('Cell Signaling Technology')).toBe(brandCanonicalPath('CST'));
    expect(productCanonicalPath('9272S', 'Cell Signaling Technology')).toBe(
      productCanonicalPath('9272S', 'CST'),
    );
  });

  it('treats account, cart, order and user protocol pages as private', () => {
    expect(isPrivateSeoPath('/login')).toBe(true);
    expect(isPrivateSeoPath('/cart')).toBe(true);
    expect(isPrivateSeoPath('/order')).toBe(true);
    expect(isPrivateSeoPath('/checkout/address')).toBe(true);
    expect(isPrivateSeoPath('/ord')).toBe(true);
    expect(isPrivateSeoPath('/protocols/user/abc')).toBe(true);
    expect(isPrivateSeoPath('/protocols/buffers/user/abc')).toBe(true);
    expect(isPrivateSeoPath('/protocols/western-blot')).toBe(false);
    expect(isPrivateSeoPath('/products/9272S?brand=CST')).toBe(false);
  });

  it('keeps public static paths out of the private list', () => {
    for (const path of STATIC_SITEMAP_PATHS) {
      expect(isPrivateSeoPath(path)).toBe(false);
    }
  });

  it('exposes product selection pages and inquiry-only brands in the sitemap', () => {
    for (const slug of ['antibodies', 'elisa-kits', 'western-blot-reagents', 'cell-culture-plates', 'cell-culture-flasks']) {
      expect(STATIC_SITEMAP_PATHS).toContain(`/products/categories/${slug}`);
    }
    expect(STATIC_SITEMAP_PATHS).toContain('/brands/Proteintech');
    expect(STATIC_SITEMAP_PATHS).toContain('/brands/' + encodeURIComponent('近岸蛋白'));
  });

  it('limits sitemap products to non-hazardous rows with catalog number, brand and name', () => {
    expect(STOREFRONT_SITEMAP_PRODUCT_WHERE).toMatchObject({
      hazardous: false,
      catalogNumber: { not: '' },
      brand: { not: '' },
      name: { not: '' },
    });
  });
});

describe('sitemap XML', () => {
  it('keeps external service domains such as cloud mail out of the sitemap', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://libereal.cn';
    expect(isCanonicalSitemapUrl('https://libereal.cn/faq')).toBe(true);
    expect(isCanonicalSitemapUrl('https://mail.libereal.cn/')).toBe(false);
  });

  it('escapes query strings and omits synthetic lastModified', () => {
    const xml = renderUrlset([
      { loc: 'https://libereal.cn/products/ab123?brand=CST&spec=100ul' },
      { loc: 'https://libereal.cn/faq', lastModified: 'not-a-date' },
    ]);
    expect(xml).toContain('https://libereal.cn/products/ab123?brand=CST&amp;spec=100ul');
    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('<lastmod>not-a-date</lastmod>');
  });

  it('renders a sitemap index of shard files', () => {
    const xml = renderSitemapIndex([
      'https://libereal.cn/sitemaps/pages.xml',
      'https://libereal.cn/sitemaps/products-0.xml',
    ]);
    expect(xml).toContain('<sitemapindex');
    expect(xml).toContain('https://libereal.cn/sitemaps/pages.xml');
    expect(xml).not.toContain('/login');
    expect(xml).not.toContain('/protocols/user/');
  });

  it('sends cacheable XML headers so crawlers are not forced onto a fresh SQLite render', () => {
    expect(SITEMAP_XML_HEADERS['Content-Type']).toBe('application/xml; charset=utf-8');
    expect(SITEMAP_XML_HEADERS['Cache-Control']).toContain('s-maxage=3600');
  });
});

describe('proxy matcher for crawler files', () => {
  it('skips robots and sitemap paths so Googlebot does not receive session cookies', () => {
    const matcher = proxyConfig.matcher[0];
    expect(matcher).toContain('robots.txt');
    expect(matcher).toContain('sitemap.xml');
    expect(matcher).toContain('sitemaps/');
  });
});
