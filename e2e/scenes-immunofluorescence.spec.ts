import { test, expect } from '@playwright/test';

const ANCHOR_IDS = [
  'workflow',
  'product-decisions',
  'prep-assistant',
  'bundle-selector',
  'difficulty',
  'support',
] as const;

test.describe('Immunofluorescence scene workbench', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);

  async function gotoIf(page: import('@playwright/test').Page) {
    await page.goto('/scenes/immunofluorescence', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '免疫荧光染色工作台', level: 1 })).toBeVisible();
  }

  test('loads workbench hero and section anchors', async ({ page }) => {
    await gotoIf(page);
    await expect(page.locator('a[href="#product-decisions"]').first()).toBeVisible();
    await expect(page.locator('a[href="#prep-assistant"]').first()).toBeVisible();
    await expect(page.locator('a[href="#difficulty"]').first()).toBeVisible();

    for (const id of ANCHOR_IDS) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test('prep assistant uses immunofluorescence-specific parameters', async ({ page }) => {
    await gotoIf(page);
    const section = page.locator('#prep-assistant');
    await expect(section.getByText('样本数量')).toBeVisible();
    await expect(section.getByText('每批处理样本')).toBeVisible();
    await expect(section.getByText('荧光通道数量')).toBeVisible();
  });

  test('workflow and support expose free open-source image tools', async ({ page }) => {
    await gotoIf(page);
    await page.waitForLoadState('networkidle');

    const workflow = page.locator('#workflow');
    await workflow.getByRole('button', { name: /抗体与通道规划/ }).click();
    await expect(workflow.getByRole('link', { name: /荧光光谱查看器/ })).toBeVisible();
    await workflow.getByRole('button', { name: /封片与成像/ }).click();
    await expect(workflow.getByText('相关产品/工具')).toBeVisible();
    await expect(workflow.getByRole('link', { name: /ImageJ\/Fiji/ })).toBeVisible();
    await expect(workflow.getByRole('link', { name: /CellProfiler/ })).toBeVisible();

    const support = page.locator('#support');
    await expect(support.getByRole('button').first()).toContainText('免费开源工具');
    await expect(support.getByRole('heading', { name: '细胞图像分析' })).toBeVisible();
    await expect(support.getByRole('link', { name: /^ImageJ\/Fiji/ })).toBeVisible();
    await expect(support.getByRole('link', { name: /^CellProfiler/ })).toBeVisible();
    await expect(support.getByRole('link', { name: /^QuPath/ })).toBeVisible();
  });

  test('direct hash URL lands on difficulty section', async ({ page }) => {
    await page.goto('/scenes/immunofluorescence#difficulty', { waitUntil: 'domcontentloaded' });
    const section = page.locator('#difficulty');
    await expect(section).toBeInViewport({ ratio: 0.15 });
    await expect(section.getByRole('heading', { name: /荧光图像不理想/ })).toBeVisible();
  });
});
