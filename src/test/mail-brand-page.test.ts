import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderRobotsTxt } from '@/lib/seo/crawlers';
import { isPrivateSeoPath, STATIC_SITEMAP_PATHS } from '@/lib/seo/public-urls';

const root = process.cwd();

function readSource(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('LIBEREAL MAIL public homepage', () => {
  const page = readSource('src/app/mail/page.tsx');

  it('describes the internal app, Google sign-in data, and public policy links', () => {
    expect(page).toContain('LIBEREAL MAIL 是 Libereal 内部使用的邮件管理系统');
    expect(page).toContain('SITE_LEGAL_NAME');
    expect(page).toContain('Google 登录只用于核验用户身份');
    expect(page).toContain('姓名');
    expect(page).toContain('电子邮件地址');
    expect(page).toContain('Google 账号标识');
    expect(page).toContain('openid');
    expect(page).toContain('不用于广告');
    expect(page).toContain('不共享，也不出售');
    expect(page).toContain('https://mail.libereal.cn');
    expect(page).toContain('href="/privacy"');
    expect(page).toContain('href="/terms"');
    expect(page).toContain('info@libereal.cn');
    expect(page).toContain('SERVICE_EMAILS.support');
    expect(page).toContain('SERVICE_EMAILS.legal');
    expect(page).toContain('LIBEREAL MAIL is the email management system used internally by Libereal');
    expect(page).toContain('/brand/libereal-mail-logo.svg');
    expect(page).not.toContain('mail-logo-1');
    expect(page).toContain('index: true');
    expect(page).not.toContain('noindex');
  });

  it('stays public in the sitemap and robots.txt', () => {
    expect(STATIC_SITEMAP_PATHS).toContain('/mail');
    expect(isPrivateSeoPath('/mail')).toBe(false);
    const robots = renderRobotsTxt();
    expect(robots).toContain('Allow: /mail');
    expect(robots).not.toContain('Disallow: /mail');
  });
});

describe('LIBEREAL MAIL privacy disclosure', () => {
  const privacy = readSource('src/app/privacy/page.tsx');

  it('adds Google user data terms without removing the existing contact block', () => {
    expect(privacy).toContain('id="libereal-mail"');
    expect(privacy).toContain('LIBEREAL MAIL 与 Google 用户数据');
    expect(privacy).toContain('Google API Services User Data Policy');
    expect(privacy).toContain('Limited Use');
    expect(privacy).toContain('30 日内删除');
    expect(privacy).toContain('legal@libereal.cn');
    expect(privacy).toContain('十一、联系我们');
    expect(privacy).toContain('苏ICP备2026025232号');
  });
});

describe('LIBEREAL MAIL logo files', () => {
  it('centers the site wordmark on a square 120x120 mark', async () => {
    const svg = readSource('public/brand/libereal-mail-logo.svg');
    const wordmark = readSource('public/libereal-wordmark.svg');
    expect(svg).toContain('viewBox="0 0 120 120"');
    expect(svg).toContain('fill="#ecfdf5"');
    expect(svg).toContain('#10b981');
    expect(svg).toContain('#059669');
    expect(svg).toContain(wordmark.match(/<path transform="translate\(0 0\)" d="[^"]+"/)?.[0] ?? 'missing-wordmark-path');
    const meta = await sharp(join(root, 'public/brand/libereal-mail-logo.png')).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(120);
    expect(meta.height).toBe(120);
  });
});
