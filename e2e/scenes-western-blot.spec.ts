import { test, expect } from '@playwright/test';

const ANCHOR_IDS = [
  'workflow',
  'product-decisions',
  'prep-assistant',
  'bundle-selector',
  'difficulty',
  'support',
] as const;

test.describe('Western Blot scene workbench', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);

  async function gotoWb(page: import('@playwright/test').Page) {
    await page.goto('/scenes/western-blot', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Western Blot 实验工作台', level: 1 })).toBeVisible();
  }

  test('loads workbench hero and section anchors', async ({ page }) => {
    await gotoWb(page);
    await expect(page.locator('a[href="#product-decisions"]').first()).toBeVisible();
    await expect(page.locator('a[href="#prep-assistant"]').first()).toBeVisible();
    await expect(page.locator('a[href="#difficulty"]').first()).toBeVisible();

    for (const id of ANCHOR_IDS) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test('hero CTA scrolls to prep assistant', async ({ page }) => {
    await gotoWb(page);
    await page.locator('a[href="#prep-assistant"]').first().click();
    const section = page.locator('#prep-assistant');
    await expect(section).toBeInViewport({ ratio: 0.2 });
    await expect(section.getByText('实验材料准备助手')).toBeVisible();
  });

  test('workflow and support expose free open-source densitometry tool', async ({ page }) => {
    await gotoWb(page);
    await page.waitForLoadState('networkidle');

    const workflow = page.locator('#workflow');
    await workflow.getByRole('button', { name: /显影与复核/ }).click();
    await expect(workflow.getByText('相关产品/工具')).toBeVisible();
    await expect(workflow.getByRole('link', { name: /ImageJ\/Fiji/ })).toBeVisible();

    const support = page.locator('#support');
    await expect(support.getByRole('button').first()).toContainText('免费开源工具');
    await expect(support.getByRole('heading', { name: '条带定量' })).toBeVisible();
    await expect(support.getByRole('link', { name: /^ImageJ\/Fiji/ })).toBeVisible();
  });

  test('direct hash URL lands on difficulty section', async ({ page }) => {
    await page.goto('/scenes/western-blot#difficulty', { waitUntil: 'domcontentloaded' });
    const section = page.locator('#difficulty');
    await expect(section).toBeInViewport({ ratio: 0.15 });
    await expect(section.getByRole('heading', { name: /结果不理想/ })).toBeVisible();
  });
});
