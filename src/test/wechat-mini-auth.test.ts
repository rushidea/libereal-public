import { afterEach, describe, expect, it, vi } from 'vitest';

describe('wechat-mini-auth', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('normalizes mini program provider account ids', async () => {
    const { normalizeWechatMiniProviderAccountId } = await import('@/lib/wechat-mini-auth');

    expect(normalizeWechatMiniProviderAccountId({ openid: 'openid_1' })).toBe('mini_openid:openid_1');
    expect(normalizeWechatMiniProviderAccountId({ openid: 'openid_1', unionid: 'union_1' })).toBe('union_1');
  });

  it('returns null scheme when mini program credentials are missing', async () => {
    const { generateWechatMiniScheme } = await import('@/lib/wechat-mini-auth');

    await expect(generateWechatMiniScheme('wmc_test')).resolves.toBeNull();
  });

  it('generates official WeChat URL Scheme through WeChat API', async () => {
    vi.stubEnv('WECHAT_MINI_APP_ID', 'wx-mini-appid');
    vi.stubEnv('WECHAT_MINI_APP_SECRET', 'mini-secret');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'access-token', expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ errcode: 0, openlink: 'weixin://dl/business/?t=ticket' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { generateWechatMiniScheme } = await import('@/lib/wechat-mini-auth');
    await expect(generateWechatMiniScheme('wmc_test')).resolves.toBe('weixin://dl/business/?t=ticket');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('https://api.weixin.qq.com/cgi-bin/token');
    expect(String(fetchMock.mock.calls[0][0])).toContain('appid=wx-mini-appid');

    const schemeBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string) as {
      jump_wxa: { path: string; query: string };
      is_expire: boolean;
      expire_time: number;
    };
    expect(String(fetchMock.mock.calls[1][0])).toContain('https://api.weixin.qq.com/wxa/generatescheme');
    expect(schemeBody.jump_wxa).toEqual({
      path: 'pages/login/index',
      query: 'challengeId=wmc_test',
    });
    expect(schemeBody.is_expire).toBe(true);
    expect(schemeBody.expire_time).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
