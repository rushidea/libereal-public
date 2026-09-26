import { describe, expect, it } from 'vitest';
import { buildSearchEngineOtherMeta, renderRobotsTxt } from '@/lib/seo/crawlers';
import { noindexFollowRobots, noindexRobots, privatePageMetadata } from '@/lib/seo/robots';
import { GET as robotsTxtGET } from '@/app/robots.txt/route';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('private page robots', () => {
  it('disables indexing for private HTML pages', () => {
    expect(privatePageMetadata.robots).toEqual(noindexRobots);
    expect(noindexRobots).toMatchObject({ index: false, follow: false });
  });

  it('keeps follow enabled for the multi-brand chooser', () => {
    expect(noindexFollowRobots).toMatchObject({ index: false, follow: true });
  });
});

describe('robots.txt for Bing and Sogou', () => {
  it('repeats allow and disallow rules for Bing and Sogou crawlers', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://libereal.cn';
    const body = renderRobotsTxt();
    expect(body).toContain('User-agent: *');
    expect(body).toContain('User-agent: bingbot');
    expect(body).toContain('User-agent: msnbot');
    expect(body).toContain('User-agent: Sogou web spider');
    expect(body).toContain('User-agent: Sogou inst spider');
    expect(body).toContain('Disallow: /api/');
    expect(body).toContain('Disallow: /admin/');
    expect(body).toContain('Disallow: /account/');
    expect(body).toContain('Disallow: /login');
    expect(body).toContain('Disallow: /register');
    expect(body).toContain('Disallow: /cart');
    expect(body).toContain('Disallow: /order');
    expect(body).toContain('Disallow: /checkout');
    expect(body).toContain('Disallow: /reset-password');
    expect(body).toContain('Disallow: /forgot-password');
    expect(body).toContain('Sitemap: https://libereal.cn/sitemap.xml');
    expect(body).toContain('Host: https://libereal.cn');
  });

  it('serves the generated robots.txt as plain text', async () => {
    const response = await robotsTxtGET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    const body = await response.text();
    expect(body).toContain('User-agent: bingbot');
    expect(body).toContain('User-agent: Sogou web spider');
  });
});

describe('search engine HTML verification files', () => {
  it('keeps the Google Search Console root HTML file in public/', () => {
    const filePath = join(process.cwd(), 'public/googled090714ea43283ca.html');
    const body = readFileSync(filePath, 'utf8').trim();
    expect(body).toBe('google-site-verification: googled090714ea43283ca.html');
  });

  it('keeps a Bing robots meta and a Sogou applicable-device hint on public pages', () => {
    expect(buildSearchEngineOtherMeta()).toMatchObject({
      bingbot: 'index, follow, max-image-preview:large, max-snippet:-1',
      'applicable-device': 'pc,mobile',
    });
  });
});
