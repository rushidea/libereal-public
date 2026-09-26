import { test, expect } from '@playwright/test';

const ANCHOR_IDS = [
  'workflow',
  'product-decisions',
  'prep-assistant',
  'bundle-selector',
  'difficulty',
  'support',
] as const;

test.describe('Molecular biology scene workbench', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);

  async function gotoMolecularBiology(page: import('@playwright/test').Page) {
    await page.goto('/scenes/molecular-biology', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '分子生物学工作台', level: 1 })).toBeVisible();
  }

  test('loads workbench hero and section anchors', async ({ page }) => {
    await gotoMolecularBiology(page);
    await expect(page.locator('a[href="#workflow"]').first()).toBeVisible();
    await expect(page.locator('a[href="#prep-assistant"]').first()).toBeVisible();
    await expect(page.locator('a[href="#difficulty"]').first()).toBeVisible();

    for (const id of ANCHOR_IDS) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }
  });

  test('prep assistant uses molecular biology parameters', async ({ page }) => {
    await gotoMolecularBiology(page);
    const section = page.locator('#prep-assistant');
    await expect(section.getByText('样本数量')).toBeVisible();
    await expect(section.getByText('每批反应数')).toBeVisible();
    await expect(section.getByText('检测基因/构建数量')).toBeVisible();
    await expect(section.getByText('总预估反应')).toBeVisible();
  });

  test('workflow links to public tools and site resources', async ({ page }) => {
    await gotoMolecularBiology(page);
    await page.waitForLoadState('networkidle');
    const section = page.locator('#workflow');
    await section.getByRole('button', { name: /PCR\/qPCR 体系设计/ }).click();
    await expect(section.getByText('引物与对照清单')).toBeVisible();
    await expect(section.getByText('相关产品/工具')).toBeVisible();
    await expect(section.getByRole('link', { name: /PrimerBank/ })).toBeVisible();
    await expect(section.getByRole('link', { name: /NCBI Primer-BLAST/ })).toBeVisible();
    await expect(section.getByRole('link', { name: /UCSC In-Silico PCR/ })).toBeVisible();

    await section.getByRole('button', { name: /验证与结果复核/ }).click();
    await expect(section.getByRole('link', { name: /ENCORI/ })).toBeVisible();
    await expect(section.getByRole('link', { name: /Western Blot 场景/ })).toBeVisible();
  });

  test('direct hash URL lands on difficulty section', async ({ page }) => {
    await page.goto('/scenes/molecular-biology#difficulty', { waitUntil: 'domcontentloaded' });
    const section = page.locator('#difficulty');
    await expect(section).toBeInViewport({ ratio: 0.15 });
    await expect(section.getByRole('heading', { name: /扩增或构建不顺利/ })).toBeVisible();
  });

  test('shows public tools and RNA mechanism databases', async ({ page }) => {
    await gotoMolecularBiology(page);
    await page.waitForLoadState('networkidle');
    const section = page.locator('#support');
    await expect(section.getByRole('button').first()).toContainText('免费开源工具');
    await expect(section.getByRole('heading', { name: '引物设计' })).toBeVisible();
    await expect(section.getByRole('heading', { name: 'RNA 调控与靶标' })).toBeVisible();

    await expect(section.getByRole('link', { name: /PrimerBank/ })).toBeVisible();
    await expect(section.getByRole('link', { name: /NCBI Primer-BLAST/ })).toBeVisible();
    await expect(section.getByRole('link', { name: /UCSC In-Silico PCR/ })).toBeVisible();
    await expect(section.getByRole('link', { name: /Sequence Manipulation Suite/ })).toBeVisible();
    await expect(section.getByRole('link', { name: /^ENCORI \/ starBase/ })).toBeVisible();
    await expect(section.getByRole('link', { name: /miRTarBase/ })).toBeVisible();
    await expect(section.getByRole('link', { name: /IDT/ })).toHaveCount(0);
    await expect(section.getByRole('link', { name: /NEB/ })).toHaveCount(0);
  });
});
