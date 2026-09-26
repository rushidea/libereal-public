import { test, expect } from '@playwright/test';

const ANCHOR_IDS = [
  'workflow',
  'product-decisions',
  'spectrum-viewer',
  'prep-assistant',
  'bundle-selector',
  'difficulty',
  'support',
] as const;

test.describe('Flow cytometry scene workbench', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);

  async function gotoFlow(page: import('@playwright/test').Page) {
    await page.goto('/scenes/flow-cytometry', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '流式细胞术工作台', level: 1 })).toBeVisible();
  }

  test('loads workbench hero and section anchors', async ({ page }) => {
    await gotoFlow(page);
    await expect(page.locator('a[href="#product-decisions"]').first()).toBeVisible();
    await expect(page.locator('a[href="#spectrum-viewer"]').first()).toBeVisible();
    await expect(page.locator('a[href="#prep-assistant"]').first()).toBeVisible();
    await expect(page.locator('a[href="#difficulty"]').first()).toBeVisible();

    for (const id of ANCHOR_IDS) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test('prep assistant uses flow-specific parameters', async ({ page }) => {
    await gotoFlow(page);
    const section = page.locator('#prep-assistant');
    await expect(section.getByText('样本数量')).toBeVisible();
    await expect(section.getByText('每批上机样本')).toBeVisible();
    await expect(section.getByText('Panel marker 数量')).toBeVisible();
  });

  test('embeds fluorescence spectrum viewer for panel design', async ({ page }) => {
    await gotoFlow(page);
    await page.waitForLoadState('networkidle');
    const section = page.locator('#spectrum-viewer');
    await expect(section.getByRole('heading', { name: '荧光光谱与仪器通道' })).toBeVisible();
    await expect(section.getByRole('heading', { name: '荧光光谱查看器' })).toBeVisible();

    await section.getByRole('button', { name: /FITC/ }).click();
    await expect(section.getByText('已选 1/8 条光谱')).toBeVisible();
  });

  test('direct hash URL lands on difficulty section', async ({ page }) => {
    await page.goto('/scenes/flow-cytometry#difficulty', { waitUntil: 'domcontentloaded' });
    const section = page.locator('#difficulty');
    await expect(section).toBeInViewport({ ratio: 0.15 });
    await expect(section.getByRole('heading', { name: /流式结果不理想/ })).toBeVisible();
  });

  test('shows Cytoflow under analysis software resources', async ({ page }) => {
    await gotoFlow(page);
    await page.waitForLoadState('networkidle');
    const section = page.locator('#support');
    await expect(section.getByRole('button').first()).toContainText('免费开源工具');
    await expect(section.getByRole('heading', { name: 'FCS 数据分析' })).toBeVisible();

    await expect(section.getByRole('link', { name: /Cytoflow 分析软件/ })).toBeVisible();
    await expect(section.getByRole('link', { name: /Cytoflow 官方下载/ })).toBeVisible();
  });

  test('workflow links spectrum viewer and Cytoflow into the flow context', async ({ page }) => {
    await gotoFlow(page);
    await page.waitForLoadState('networkidle');
    const section = page.locator('#workflow');

    await section.getByRole('button', { name: /Panel 与荧光搭配/ }).click();
    await expect(section.getByText('荧光通道搭配')).toBeVisible();
    await expect(section.getByRole('link', { name: /荧光光谱查看器/ })).toBeVisible();

    await section.getByRole('button', { name: /上机与数据质控/ }).click();
    await expect(section.getByText('可解释 FCS 数据')).toBeVisible();
    await expect(section.getByRole('link', { name: /Cytoflow 用户手册/ })).toBeVisible();
  });
});
