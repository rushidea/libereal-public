import type { Page, Route } from '@playwright/test';
import { test, expect } from '@playwright/test';

/**
 * Password, passkey, and MFA completion all client-navigate with router.push.
 * Google OAuth uses a full document redirect, covered separately below.
 * Credentials are mocked so the assertion is the scroll position, not the auth backend.
 */

async function mockSuccessfulCredentials(page: Page, callbackPath: string) {
  let signedIn = false;
  await page.route('**/api/auth/callback/credentials**', async (route: Route) => {
    signedIn = true;
    const origin = new URL(page.url()).origin;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ url: `${origin}${callbackPath}` }),
    });
  });
  await page.route('**/api/auth/session**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        signedIn
          ? {
              user: { name: 'Scroll Tester', email: 'scroll-test@example.com' },
              expires: '2099-01-01T00:00:00.000Z',
            }
          : null,
      ),
    });
  });
}

async function submitLoginAtTop(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector('form');
    return !!form && Object.getOwnPropertyNames(form).some((key) => key.startsWith('__reactProps'));
  });
  await page.locator('input[type="email"]').fill('scroll-test@example.com');
  await page.locator('input[type="password"]').fill('secret-secret');
  await page.evaluate(() => {
    const email = document.querySelector<HTMLInputElement>('input[type="email"]');
    const password = document.querySelector<HTMLInputElement>('input[type="password"]');
    if (!email?.value || !password?.value) {
      throw new Error('login fields were cleared before submit');
    }
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    document.documentElement.style.scrollBehavior = '';
    document.querySelector('form')?.requestSubmit();
  });
}

test.describe('post-login scroll position', () => {
  test.describe.configure({ timeout: 60_000 });

  for (const viewport of [
    { width: 1280, height: 800, label: 'desktop' },
    { width: 390, height: 844, label: 'mobile' },
  ]) {
    test(`password login opens the homepage at the top (${viewport.label})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await mockSuccessfulCredentials(page, '/');
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await submitLoginAtTop(page);
      await page.waitForURL((url) => url.pathname === '/' && url.hash === '');
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(80);
      await expect(page.locator('[data-site-footer]')).not.toBeInViewport();
      await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
    });
  }

  test('callback hash lands on that section, not the footer', async ({ page }) => {
    await mockSuccessfulCredentials(page, '/#application-scenes');
    await page.goto(`/login?callbackUrl=${encodeURIComponent('/#application-scenes')}`, {
      waitUntil: 'domcontentloaded',
    });
    await submitLoginAtTop(page);
    await page.waitForURL((url) => url.hash === '#application-scenes');
    const section = page.locator('#application-scenes');
    await expect(section).toBeInViewport({ ratio: 0.15 });
    await expect(page.locator('[data-site-footer]')).not.toBeInViewport();
  });

  test('full document return to home starts at the top', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(80);
  });
});
