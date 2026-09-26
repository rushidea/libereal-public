import { test, expect } from '@playwright/test';

const ANCHOR_IDS = [
  'workflow',
  'elisa-calculator',
  'product-decisions',
  'prep-assistant',
  'bundle-selector',
  'difficulty',
  'support',
] as const;

test.describe('ELISA scene workbench', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);

  async function gotoElisa(page: import('@playwright/test').Page) {
    await page.goto('/scenes/elisa', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'ELISA 检测工作台', level: 1 })).toBeVisible();
  }

  test('loads workbench hero and section anchors', async ({ page }) => {
    await gotoElisa(page);
    await expect(page.locator('a[href="#product-decisions"]').first()).toBeVisible();
    await expect(page.locator('a[href="#elisa-calculator"]').first()).toBeVisible();
    await expect(page.locator('a[href="#difficulty"]').first()).toBeVisible();

    for (const id of ANCHOR_IDS) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test('hero CTA scrolls to product decision hub', async ({ page }) => {
    await gotoElisa(page);
    await page.locator('a[href="#product-decisions"]').first().click();
    const hub = page.locator('#product-decisions');
    await expect(hub).toBeInViewport({ ratio: 0.2 });
    await expect(hub.getByRole('heading', { name: /买试剂盒前先确认什么/ })).toBeVisible();
  });

  test('direct hash URL lands on difficulty section', async ({ page }) => {
    await page.goto('/scenes/elisa#difficulty', { waitUntil: 'domcontentloaded' });
    const section = page.locator('#difficulty');
    await expect(section).toBeInViewport({ ratio: 0.15 });
    await expect(section.getByRole('heading', { name: /检测遇到异常/ })).toBeVisible();
  });

  test('product decision links point to products routes', async ({ page }) => {
    await gotoElisa(page);
    const productLink = page.locator('#product-decisions a[href^="/products"]').first();
    await expect(productLink).toBeVisible();
    const href = await productLink.getAttribute('href');
    expect(href).toMatch(/^\/products/);
  });

  test('workflow and support expose the ELISA curve fitting calculator', async ({ page }) => {
    await gotoElisa(page);
    await page.waitForLoadState('networkidle');

    const workflow = page.locator('#workflow');
    await workflow.getByRole('button', { name: /样本与标准曲线/ }).click();
    await expect(workflow.getByText('相关产品/工具')).toBeVisible();
    await expect(workflow.getByRole('link', { name: /ELISA 曲线拟合计算器/ })).toBeVisible();

    await workflow.getByRole('button', { name: /读数与复购管理/ }).click();
    await expect(workflow.getByRole('link', { name: /ELISA 曲线拟合计算器/ })).toBeVisible();

    const support = page.locator('#support');
    await expect(support.getByRole('button').first()).toContainText('免费开源工具');
    await expect(support.getByRole('heading', { name: '站内计算器' })).toBeVisible();
    await expect(support.getByRole('link', { name: /^ELISA 曲线拟合计算器/ })).toBeVisible();
  });

  test('rejects spreadsheet uploads with a mismatched file signature', async ({ page }) => {
    await page.context().setExtraHTTPHeaders({
      'x-forwarded-for': `198.51.100.${(Date.now() % 240) + 1}`,
    });
    await page.goto('/support?tab=calculators&calculator=elisa', { waitUntil: 'networkidle' });
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toHaveCount(1);

    await fileInput.setInputFiles({
      name: 'elisa.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('not an xlsx file'),
    });

    await expect(
      page.getByRole('alert').filter({ hasText: '文件扩展名与文件内容不匹配。' }),
    ).toBeVisible();
  });
});
