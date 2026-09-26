import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BAIDU_PUSH_ENDPOINT,
  getBaiduPushConfig,
  submitBaiduPushUrls,
} from '@/lib/seo/baidu-push';

const originalEnv = {
  BAIDU_PUSH_TOKEN: process.env.BAIDU_PUSH_TOKEN,
  BAIDU_PUSH_SITE: process.env.BAIDU_PUSH_SITE,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
};

afterEach(() => {
  process.env.BAIDU_PUSH_TOKEN = originalEnv.BAIDU_PUSH_TOKEN;
  process.env.BAIDU_PUSH_SITE = originalEnv.BAIDU_PUSH_SITE;
  process.env.NEXT_PUBLIC_SITE_URL = originalEnv.NEXT_PUBLIC_SITE_URL;
});

describe('Baidu push config', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://libereal.cn';
  });

  it('returns null when the push token is missing', () => {
    delete process.env.BAIDU_PUSH_TOKEN;
    expect(getBaiduPushConfig()).toBeNull();
  });

  it('uses BAIDU_PUSH_SITE when provided', () => {
    process.env.BAIDU_PUSH_TOKEN = 'test-token';
    process.env.BAIDU_PUSH_SITE = 'https://libereal.cn';
    expect(getBaiduPushConfig()).toEqual({
      site: 'libereal.cn',
      token: 'test-token',
    });
  });

  it('accepts a bare host as BAIDU_PUSH_SITE', () => {
    process.env.BAIDU_PUSH_TOKEN = 'test-token';
    process.env.BAIDU_PUSH_SITE = 'libereal.cn';
    expect(getBaiduPushConfig()?.site).toBe('libereal.cn');
  });
});

describe('Baidu push submission', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://libereal.cn';
    process.env.BAIDU_PUSH_SITE = 'https://libereal.cn';
    process.env.BAIDU_PUSH_TOKEN = 'test-token';
  });

  it('skips submission when the token is missing', async () => {
    delete process.env.BAIDU_PUSH_TOKEN;
    const fetchImpl = vi.fn();
    await expect(submitBaiduPushUrls(['https://libereal.cn/products/a?brand=CST'], fetchImpl)).resolves.toEqual({
      submitted: 0,
      batches: 0,
      skipped: 'baidu_push_unconfigured',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts same-origin URLs as plain text to the Baidu endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ success: 1, remain: 99999, not_same_site: [], not_valid: [] }),
    });
    const result = await submitBaiduPushUrls(
      ['https://libereal.cn/products/ab123?brand=CST', 'https://other.example/x'],
      fetchImpl,
    );
    expect(result).toEqual({
      submitted: 1,
      batches: 1,
      success: 1,
      remain: 99999,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BAIDU_PUSH_ENDPOINT}?site=${encodeURIComponent('libereal.cn')}&token=test-token`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'https://libereal.cn/products/ab123?brand=CST',
      }),
    );
  });

  it('returns an error when Baidu responds with a non-200 status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 400,
      text: async () => 'site error',
    });
    await expect(submitBaiduPushUrls(['https://libereal.cn/products/a?brand=CST'], fetchImpl)).resolves.toMatchObject({
      submitted: 0,
      batches: 0,
      error: expect.stringContaining('baidu_push_http_400'),
    });
  });
});
