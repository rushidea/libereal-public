import { describe, expect, it } from 'vitest';
import { buildWeChatInAppLaunchUrl } from '@/lib/wechat-open-url';

describe('wechat-open-url', () => {
  it('builds in-app launch URL with callback', () => {
    const url = buildWeChatInAppLaunchUrl('/account');
    expect(url).toContain('/api/auth/wechat/launch?');
    expect(url).toContain('callbackUrl=%2Faccount');
  });

  it('uses the provided public origin on client pages', () => {
    const url = buildWeChatInAppLaunchUrl('/', 'https://libereal.cn/');
    expect(url).toBe('https://libereal.cn/api/auth/wechat/launch?callbackUrl=%2F');
  });
});
