/**
 * Debug：实际跑 home page，看 featuredProducts state
 */
import { test } from '@playwright/test';

test('home page featured products state', async ({ page }) => {
  // 捕获 console + page errors
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      errors.push(`[${msg.type()}] ${msg.text().substring(0, 300)}`);
    }
  });
  page.on('pageerror', err => {
    errors.push(`[pageerror] ${err.message.substring(0, 300)}`);
  });

  // 拦截所有 500 错误的请求
  const apiCalls: Array<{ url: string; status: number; body: string }> = [];
  page.on('response', async (res) => {
    try {
      if (res.status() >= 500 || res.url().includes('/api/')) {
        const body = await res.text();
        apiCalls.push({ url: res.url(), status: res.status(), body: body.substring(0, 200) });
      }
    } catch {}
  });

  await page.goto('http://localhost:3000/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(5000); // 等 fetch 完成

  // 找"精选产品"section
  const featuredSection = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('h2, h3, p, div'));
    const found = all.find(el => el.textContent?.trim() === '精选产品');
    if (!found) return { found: false };
    // 找 ancestor 的 section container
    let section = found.parentElement;
    while (section && section.tagName !== 'SECTION' && !section.className?.includes('space-y')) {
      section = section.parentElement;
      if (section === document.body) break;
    }
    const productCards = section?.querySelectorAll('a[href*="/products/"]') || [];
    const productNames = Array.from(productCards).slice(0, 5).map(a => a.textContent?.trim().substring(0, 50));
    return {
      found: true,
      sectionHTML: section?.innerHTML?.substring(0, 1500),
      hasEmptyMsg: section?.textContent?.includes('暂无'),
      productCount: productCards.length,
      productNames,
    };
  });
  console.log('  Featured section:', JSON.stringify(featuredSection, null, 2));

  console.log('  /api/products calls:', apiCalls.length);
  apiCalls.forEach(c => console.log('   ', c.status, c.url, c.body.substring(0, 100)));

  console.log('  Console errors:', errors.length);
  errors.forEach(e => console.log('   ', e));
});
