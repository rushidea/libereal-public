// @vitest-environment node

import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const browserSecret = 'a'.repeat(43);
const browserSecretHash = createHash('sha256').update(browserSecret).digest('hex');
const otherBrowserSecret = 'b'.repeat(43);
const cookieName = 'libereal-wmc-bind-wmc-1';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));

const cookieJar = vi.hoisted(() => new Map<string, string>());

vi.mock('@/lib/auth', () => ({ signIn: mocks.signIn }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => {
      cookieJar.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.delete(name);
    },
  })),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    wechatMiniLoginChallenge: {
      findUnique: mocks.findUnique,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
  },
}));

import { POST } from '@/app/api/auth/wechat-mini/complete/route';
import { setAccountLinkStateStoreForTests } from '@/lib/account-linking';

function memoryLinkStore() {
  const rows = new Map<string, { value: string; expiresAt: number }>();
  return {
    clear() {
      rows.clear();
    },
    async get(key: string) {
      const row = rows.get(key);
      if (!row || row.expiresAt <= Date.now()) {
        rows.delete(key);
        return null;
      }
      return row.value;
    },
    async set(key: string, value: string, ttlMs: number) {
      rows.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    async delete(key: string) {
      rows.delete(key);
    },
    async compareAndDelete(key: string, expected: string) {
      const current = await this.get(key);
      if (current == null || current !== expected) return false;
      rows.delete(key);
      return true;
    },
  };
}

const linkStore = memoryLinkStore();

function linkedChallenge(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wmc-1',
    status: 'linked',
    providerAccountId: 'wechat-user-1',
    userId: 'user-1',
    loginToken: 'login-token-1',
    oauthName: null,
    oauthImage: null,
    oauthSex: null,
    expiresAt: new Date(Date.now() + 60_000),
    browserSecretHash,
    ...overrides,
  };
}

function completeRequest(options?: { cookie?: string | null; body?: Record<string, unknown> }) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options?.cookie) headers.cookie = options.cookie;
  return new NextRequest('http://localhost/api/auth/wechat-mini/complete', {
    method: 'POST',
    body: JSON.stringify(options?.body ?? { challengeId: 'wmc-1', callbackUrl: '/orders' }),
    headers,
  });
}

function starterCookie() {
  return `${cookieName}=${browserSecret}`;
}

describe('wechat-mini complete route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieJar.clear();
    linkStore.clear();
    setAccountLinkStateStoreForTests(linkStore);
    mocks.findUnique.mockResolvedValue(linkedChallenge());
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.update.mockResolvedValue({});
  });

  afterEach(() => {
    setAccountLinkStateStoreForTests(null);
  });

  it('returns the MFA redirect and preserves callbackUrl for the browser that started the challenge', async () => {
    mocks.signIn.mockResolvedValue('http://localhost/login/mfa?challengeId=challenge-1&provider=wechat-mini');
    const response = await POST(completeRequest({ cookie: starterCookie() }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: 'linked',
      redirectUrl: '/login/mfa?challengeId=challenge-1&provider=wechat-mini&callbackUrl=%2Forders',
    });
    expect(mocks.signIn).toHaveBeenCalledWith('wechat-mini', {
      loginToken: 'login-token-1',
      redirect: false,
      redirectTo: '/orders',
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'wmc-1',
        browserSecretHash,
        status: 'linked',
        loginToken: 'login-token-1',
      }),
      data: { browserSecretHash: null },
    });
    const cleared = response.headers.get('set-cookie') ?? '';
    expect(cleared.toLowerCase()).toContain('httponly');
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).not.toContain(browserSecret);
  });

  it('keeps the original callback when MFA is disabled', async () => {
    mocks.signIn.mockResolvedValue('/orders');
    const response = await POST(completeRequest({ cookie: starterCookie() }));

    expect(response.status).toBe(200);
    expect((await response.json()).redirectUrl).toBe('/orders');
  });

  it('does not treat a non-MFA pathname containing login/mfa as an MFA redirect', async () => {
    mocks.signIn.mockResolvedValue('/orders/login/mfa-history');
    const response = await POST(completeRequest({ cookie: starterCookie() }));

    expect((await response.json()).redirectUrl).toBe('/orders/login/mfa-history');
  });

  it('rejects a hijack that only knows the displayed challengeId', async () => {
    const response = await POST(completeRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: '请回到发起登录的浏览器完成登录' });
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(cookieJar.size).toBe(0);
  });

  it('rejects a hijacker who puts the browser secret in the JSON body instead of the cookie', async () => {
    const response = await POST(completeRequest({
      body: { challengeId: 'wmc-1', callbackUrl: '/orders', browserSecret },
    }));

    expect(response.status).toBe(403);
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    const body = await response.json() as { error?: string };
    expect(JSON.stringify(body)).not.toContain(browserSecret);
    expect(JSON.stringify(body)).not.toContain('login-token-1');
  });

  it('rejects another browser that presents a different secret for the same challengeId', async () => {
    const response = await POST(completeRequest({
      cookie: `${cookieName}=${otherBrowserSecret}`,
    }));

    expect(response.status).toBe(403);
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('does not let a hijacker claim an unlinked WeChat identity', async () => {
    mocks.findUnique.mockResolvedValue(linkedChallenge({
      status: 'unlinked',
      userId: null,
      loginToken: null,
    }));

    const response = await POST(completeRequest());

    expect(response.status).toBe(403);
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(cookieJar.has('pending-oauth-link')).toBe(false);
  });

  it('lets the starting browser finish an unlinked registration once', async () => {
    mocks.findUnique.mockResolvedValue(linkedChallenge({
      status: 'unlinked',
      userId: null,
      loginToken: null,
      oauthName: '微信用户',
    }));

    const response = await POST(completeRequest({ cookie: starterCookie() }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: 'unlinked',
      redirectUrl: '/register?wechat=unlinked&callbackUrl=%2Forders',
    });
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'wmc-1',
        browserSecretHash,
        status: 'unlinked',
      }),
      data: expect.objectContaining({
        browserSecretHash: null,
        status: 'consumed',
      }),
    });
    expect(cookieJar.has('pending-oauth-link')).toBe(true);
  });

  it('rejects a second completion after the browser secret is consumed', async () => {
    let storedHash: string | null = browserSecretHash;
    mocks.findUnique.mockImplementation(async () => linkedChallenge({ browserSecretHash: storedHash }));
    mocks.updateMany.mockImplementation(async () => {
      if (storedHash !== browserSecretHash) return { count: 0 };
      storedHash = null;
      return { count: 1 };
    });
    mocks.signIn.mockResolvedValue('/orders');

    const first = await POST(completeRequest({ cookie: starterCookie() }));
    expect(first.status).toBe(200);
    mocks.signIn.mockClear();

    const replay = await POST(completeRequest({ cookie: starterCookie() }));
    expect(replay.status).toBe(403);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('does not sign in when a parallel completion already claimed the secret', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    const response = await POST(completeRequest({ cookie: starterCookie() }));

    expect(response.status).toBe(409);
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('does not consume the browser secret before WeChat authorization finishes', async () => {
    mocks.findUnique.mockResolvedValue(linkedChallenge({
      status: 'pending',
      userId: null,
      loginToken: null,
    }));

    const response = await POST(completeRequest({ cookie: starterCookie() }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: '微信授权尚未完成' });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it('expires a matching browser secret without creating a session', async () => {
    mocks.findUnique.mockResolvedValue(linkedChallenge({
      expiresAt: new Date(Date.now() - 1000),
    }));

    const response = await POST(completeRequest({ cookie: starterCookie() }));

    expect(response.status).toBe(410);
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'wmc-1' },
      data: {
        status: 'expired',
        loginToken: null,
        browserSecretHash: null,
      },
    });
  });

  it('restores the browser secret when sign-in fails before the login token is consumed', async () => {
    mocks.signIn.mockRejectedValue(new Error('auth down'));

    const response = await POST(completeRequest({ cookie: starterCookie() }));

    expect(response.status).toBe(500);
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'wmc-1',
        browserSecretHash: null,
        loginToken: 'login-token-1',
        status: 'linked',
      },
      data: { browserSecretHash },
    });
  });
});
