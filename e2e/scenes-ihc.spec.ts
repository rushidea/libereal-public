import { test, expect } from '@playwright/test';

const ANCHOR_IDS = [
  'workflow',
  'product-decisions',
  'prep-assistant',
  'bundle-selector',
  'difficulty',
  'support',
] as const;

test.describe('IHC scene workbench', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);

  async function gotoIhc(page: import('@playwright/test').Page) {
    await page.goto('/scenes/ihc', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'IHC 免疫组化工作台', level: 1 })).toBeVisible();
  }

  test('loads workbench hero and section anchors', async ({ page }) => {
    await gotoIhc(page);
    await expect(page.locator('a[href="#product-decisions"]').first()).toBeVisible();
    await expect(page.locator('a[href="#prep-assistant"]').first()).toBeVisible();
    await expect(page.locator('a[href="#difficulty"]').first()).toBeVisible();

    for (const id of ANCHOR_IDS) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test('prep assistant uses IHC-specific parameters', async ({ page }) => {
    await gotoIhc(page);
    const section = page.locator('#prep-assistant');
    await expect(section.getByText('样本切片数量')).toBeVisible();
    await expect(section.getByText('每批染色切片')).toBeVisible();
    await expect(section.getByText('检测靶标数量')).toBeVisible();
  });

  test('workflow and support expose free open-source image tools', async ({ page }) => {
    await gotoIhc(page);
    await page.waitForLoadState('networkidle');

    const workflow = page.locator('#workflow');
    await workflow.getByRole('button', { name: /显色、复染与成像/ }).click();
    await expect(workflow.getByText('相关产品/工具')).toBeVisible();
    await expect(workflow.getByRole('link', { name: /QuPath/ })).toBeVisible();
    await expect(workflow.getByRole('link', { name: /ImageJ\/Fiji/ })).toBeVisible();

    const support = page.locator('#support');
    await expect(support.getByRole('button').first()).toContainText('免费开源工具');
    await expect(support.getByRole('heading', { name: '组织图像分析' })).toBeVisible();
    await expect(support.getByRole('link', { name: /^QuPath/ })).toBeVisible();
    await expect(support.getByRole('link', { name: /^ImageJ\/Fiji/ })).toBeVisible();
  });

  test('direct hash URL lands on difficulty section', async ({ page }) => {
    await page.goto('/scenes/ihc#difficulty', { waitUntil: 'domcontentloaded' });
    const section = page.locator('#difficulty');
    await expect(section).toBeInViewport({ ratio: 0.15 });
    await expect(section.getByRole('heading', { name: /染色结果不理想/ })).toBeVisible();
  });
});
