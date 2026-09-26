import { describe, expect, it, vi } from 'vitest';
import {
  canonicalSiteUrl,
  getCanonicalSiteOrigin,
  getPublicSiteOrigin,
  isPublicHttpOrigin,
  toAbsoluteCanonicalUrl,
} from '@/lib/site-url';

describe('getPublicSiteOrigin', () => {
  it('prefers AUTH_URL over request-local defaults', () => {
    vi.stubEnv('AUTH_URL', 'https://libereal.cn');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    expect(getPublicSiteOrigin()).toBe('https://libereal.cn');
    vi.unstubAllEnvs();
  });

  it('strips trailing slash', () => {
    vi.stubEnv('AUTH_URL', 'https://libereal.cn/');
    expect(getPublicSiteOrigin()).toBe('https://libereal.cn');
    vi.unstubAllEnvs();
  });

  it('uses the supplied request origin when no public origin is configured', () => {
    vi.stubEnv('AUTH_URL', '');
    vi.stubEnv('NEXTAUTH_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    expect(getPublicSiteOrigin('http://localhost:3001')).toBe('http://localhost:3001');
    vi.unstubAllEnvs();
  });
});

describe('getCanonicalSiteOrigin', () => {
  it('prefers NEXT_PUBLIC_SITE_URL over AUTH_URL', () => {
    vi.stubEnv('AUTH_URL', 'https://auth.example.com');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://libereal.cn');
    expect(getCanonicalSiteOrigin()).toBe('https://libereal.cn');
    vi.unstubAllEnvs();
  });

  it('defaults to the production origin when public site URL is empty', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('AUTH_URL', 'https://auth.example.com');
    expect(getCanonicalSiteOrigin()).toBe('https://libereal.cn');
    vi.unstubAllEnvs();
  });

  it('normalizes www to the apex domain', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.libereal.cn');
    expect(getCanonicalSiteOrigin()).toBe('https://libereal.cn');
    vi.unstubAllEnvs();
  });
});

describe('canonicalSiteUrl', () => {
  it('builds a site-relative canonical URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://libereal.cn');
    expect(canonicalSiteUrl('/faq')).toBe('https://libereal.cn/faq');
    vi.unstubAllEnvs();
  });
});

describe('toAbsoluteCanonicalUrl', () => {
  it('does not double-prefix an absolute cover URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://libereal.cn');
    expect(toAbsoluteCanonicalUrl('https://cdn.example.com/cover.jpg')).toBe('https://cdn.example.com/cover.jpg');
    expect(toAbsoluteCanonicalUrl('/wechat/articles/001/cover.webp')).toBe(
      'https://libereal.cn/wechat/articles/001/cover.webp',
    );
    vi.unstubAllEnvs();
  });
});

describe('isPublicHttpOrigin', () => {
  it('accepts a public HTTPS site and rejects local origins', () => {
    expect(isPublicHttpOrigin('https://libereal.cn')).toBe(true);
    expect(isPublicHttpOrigin('http://localhost:3000')).toBe(false);
    expect(isPublicHttpOrigin('http://127.0.0.1:3000')).toBe(false);
  });
});
