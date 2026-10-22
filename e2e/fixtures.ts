import { test as base, expect } from '@playwright/test';

/**
 * Knocket 会保持长轮询，waitForLoadState('networkidle') 因此不会结束。
 * 这些场景测试只需要等站点自己的请求完成。
 */
export const test = base.extend({
  page: async ({ page }, run) => {
    await page.route(
      /https?:\/\/([^/]*\.)?(trtc\.io|gstatic\.com|qcloud\.com|my-imcloud\.com|my-cpaas\.com|tim\.qq\.com|tencent\.cn)\//,
      (route) => route.abort(),
    );
    await run(page);
  },
});

export { expect };
