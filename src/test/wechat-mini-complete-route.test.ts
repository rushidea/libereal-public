// @vitest-environment node

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ signIn: mocks.signIn }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    wechatMiniLoginChallenge: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));

import { POST } from '@/app/api/auth/wechat-mini/complete/route';

describe('wechat-mini complete route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: 'wmc-1',
      status: 'linked',
      providerAccountId: 'wechat-user-1',
      userId: 'user-1',
      loginToken: 'login-token-1',
      oauthName: null,
      oauthImage: null,
      oauthSex: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
  });

  it('returns the MFA redirect and preserves callbackUrl', async () => {
    mocks.signIn.mockResolvedValue('http://localhost/login/mfa?challengeId=challenge-1&provider=wechat-mini');
    const response = await POST(new NextRequest('http://localhost/api/auth/wechat-mini/complete', {
      method: 'POST',
      body: JSON.stringify({ challengeId: 'wmc-1', callbackUrl: '/orders' }),
      headers: { 'content-type': 'application/json' },
    }));

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
  });

  it('keeps the original callback when MFA is disabled', async () => {
    mocks.signIn.mockResolvedValue('/orders');
    const response = await POST(new NextRequest('http://localhost/api/auth/wechat-mini/complete', {
      method: 'POST',
      body: JSON.stringify({ challengeId: 'wmc-1', callbackUrl: '/orders' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect((await response.json()).redirectUrl).toBe('/orders');
  });

  it('does not treat a non-MFA pathname containing login/mfa as an MFA redirect', async () => {
    mocks.signIn.mockResolvedValue('/orders/login/mfa-history');
    const response = await POST(new NextRequest('http://localhost/api/auth/wechat-mini/complete', {
      method: 'POST',
      body: JSON.stringify({ challengeId: 'wmc-1', callbackUrl: '/orders' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect((await response.json()).redirectUrl).toBe('/orders/login/mfa-history');
  });
});
