import { expect, test } from '@playwright/test';

test.describe('products catalog server-rendered heading', () => {
  test('returns the catalog H1 in raw HTML for brand and subcategory URLs', async ({ request }) => {
    for (const path of [
      '/products/catalog',
      '/products/catalog?brand=Libereal%20Test',
      '/products/catalog?cat=%E4%B8%80%E6%8A%97&sub=WB%E6%8A%97%E4%BD%93',
      '/products/catalog?cat=unknown-category&sub=WB%E6%8A%97%E4%BD%93',
    ]) {
      const response = await request.get(path);
      expect(response.ok(), path).toBeTruthy();
      const html = await response.text();
      const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '';

      expect(heading, `raw HTML H1 for ${path}`).toContain('产品目录');
    }
  });

  test('renders the keyword-specific H1 before client JavaScript runs', async ({ request }) => {
    const response = await request.get('/products/catalog?keyword=ssr-heading-probe');
    expect(response.ok()).toBeTruthy();

    const html = await response.text();
    const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '';

    expect(heading).toContain('搜索');
    expect(heading).toContain('ssr-heading-probe');
  });
});
