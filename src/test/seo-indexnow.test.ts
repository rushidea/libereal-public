import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  productFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    product: { findMany: mocks.productFindMany },
  },
}));

import { GET as indexNowKeyGET } from '@/app/indexnow-key.txt/route';
import { GET as indexNowCronGET } from '@/app/api/cron/indexnow/route';
import {
  filterIndexNowUrls,
  getIndexNowKey,
  getIndexNowKeyFilePath,
  INDEXNOW_ENDPOINT,
  listRecentlyUpdatedStorefrontUrls,
  pingBingSitemap,
  submitIndexNowUrls,
} from '@/lib/seo/indexnow';

const originalEnv = {
  INDEXNOW_KEY: process.env.INDEXNOW_KEY,
  CRON_SECRET: process.env.CRON_SECRET,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
};

afterEach(() => {
  process.env.INDEXNOW_KEY = originalEnv.INDEXNOW_KEY;
  process.env.CRON_SECRET = originalEnv.CRON_SECRET;
  process.env.NEXT_PUBLIC_SITE_URL = originalEnv.NEXT_PUBLIC_SITE_URL;
});

describe('IndexNow key and URL filtering', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://libereal.cn';
  });

  it('rejects short or invalid keys', () => {
    process.env.INDEXNOW_KEY = 'abc';
    expect(getIndexNowKey()).toBeNull();
    process.env.INDEXNOW_KEY = 'bad key!!';
    expect(getIndexNowKey()).toBeNull();
    process.env.INDEXNOW_KEY = 'indexnow-key-01';
    expect(getIndexNowKey()).toBe('indexnow-key-01');
  });

  it('keeps same-origin public URLs and drops foreign hosts', () => {
    const urls = filterIndexNowUrls([
      'https://libereal.cn/products/ab123?brand=CST',
      'https://libereal.cn/products/ab123?brand=CST',
      'https://evil.example/products/ab123?brand=CST',
      'not-a-url',
      '  ',
    ]);
    expect(urls).toEqual(['https://libereal.cn/products/ab123?brand=CST']);
  });

  it('returns 404 for the key file when IndexNow is unconfigured', async () => {
    delete process.env.INDEXNOW_KEY;
    const response = await indexNowKeyGET();
    expect(response.status).toBe(404);
  });

  it('serves the IndexNow key as plain text', async () => {
    process.env.INDEXNOW_KEY = 'indexnow-key-01';
    const response = await indexNowKeyGET();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('indexnow-key-01');
  });

  it('uses the Bing root key filename as keyLocation', () => {
    process.env.INDEXNOW_KEY = 'indexnow-key-01';
    expect(getIndexNowKeyFilePath()).toBe('/indexnow-key-01.txt');
  });
});

describe('IndexNow submission', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://libereal.cn';
  });

  it('skips submission when the key is missing', async () => {
    delete process.env.INDEXNOW_KEY;
    const fetchImpl = vi.fn();
    await expect(submitIndexNowUrls(['https://libereal.cn/products/a?brand=CST'], fetchImpl)).resolves.toEqual({
      submitted: 0,
      batches: 0,
      skipped: 'indexnow_unconfigured',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts same-origin URLs to the IndexNow endpoint', async () => {
    process.env.INDEXNOW_KEY = 'indexnow-key-01';
    const fetchImpl = vi.fn().mockResolvedValue({ status: 202, text: async () => '' });
    const result = await submitIndexNowUrls(
      ['https://libereal.cn/products/ab123?brand=CST', 'https://other.example/x'],
      fetchImpl,
    );
    expect(result).toEqual({ submitted: 1, batches: 1 });
    expect(fetchImpl).toHaveBeenCalledWith(
      INDEXNOW_ENDPOINT,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"host":"libereal.cn"'),
      }),
    );
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as { body: string }).body) as {
      urlList: string[];
      keyLocation: string;
    };
    expect(body.urlList).toEqual(['https://libereal.cn/products/ab123?brand=CST']);
    expect(body.keyLocation).toBe('https://libereal.cn/indexnow-key-01.txt');
  });

  it('pings the Bing sitemap endpoint with the canonical sitemap URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    await expect(pingBingSitemap(fetchImpl)).resolves.toEqual({ ok: true });
    expect(String(fetchImpl.mock.calls[0][0])).toContain(
      'sitemap=https%3A%2F%2Flibereal.cn%2Fsitemap.xml',
    );
  });
});

describe('IndexNow cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SITE_URL = 'https://libereal.cn';
    mocks.productFindMany.mockResolvedValue([]);
  });

  it('lists recently updated storefront product URLs', async () => {
    mocks.productFindMany.mockResolvedValue([
      { catalogNumber: '9272S', brand: 'CST' },
      { catalogNumber: '9272S', brand: 'CST' },
    ]);
    const urls = await listRecentlyUpdatedStorefrontUrls(new Date('2026-08-01T00:00:00.000Z'));
    expect(urls).toEqual(['https://libereal.cn/products/9272S?brand=CST']);
    expect(mocks.productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ hazardous: false }),
      }),
    );
  });

  it('rejects cron calls without the shared secret', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    const response = await indexNowCronGET(
      new Request('https://libereal.cn/api/cron/indexnow') as never,
    );
    expect(response.status).toBe(403);
  });
});
