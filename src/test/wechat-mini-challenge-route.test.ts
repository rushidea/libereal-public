// @vitest-environment node

import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    wechatMiniLoginChallenge: {
      create: mocks.create,
    },
  },
}));

import { POST } from '@/app/api/auth/wechat-mini/challenge/route';
import { WECHAT_MINI_BROWSER_SECRET_TTL_SECONDS } from '@/lib/wechat-mini-auth';

function cookieValue(setCookie: string): string {
  const pair = setCookie.split(';')[0] ?? '';
  const separator = pair.indexOf('=');
  return decodeURIComponent(pair.slice(separator + 1));
}

describe('wechat-mini challenge route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockImplementation(async ({ data }: { data: { id: string; expiresAt: Date } }) => ({
      id: data.id,
      expiresAt: data.expiresAt,
    }));
  });

  it('keeps the browser secret in an httpOnly cookie and out of the page payload', async () => {
    const response = await POST();
    const body = await response.json() as {
      challengeId: string;
      expiresAt: string;
      miniProgram: { query: string; scheme: string | null; path: string };
    };
    const setCookie = response.headers.get('set-cookie') ?? '';
    const secret = cookieValue(setCookie);
    const stored = mocks.create.mock.calls[0]?.[0]?.data as { browserSecretHash?: string; id?: string };

    expect(response.status).toBe(200);
    expect(body.challengeId).toMatch(/^wmc_/);
    expect(body.miniProgram.query).toBe(`challengeId=${body.challengeId}`);
    expect(body.miniProgram.path).toBe('pages/login/index');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(setCookie).toContain('Path=/api/auth/wechat-mini/complete');
    expect(setCookie).toContain(`Max-Age=${WECHAT_MINI_BROWSER_SECRET_TTL_SECONDS}`);
    expect(setCookie).toContain(`libereal-wmc-bind-${body.challengeId}=`);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored.browserSecretHash).toBe(createHash('sha256').update(secret).digest('hex'));
    expect(stored.browserSecretHash).not.toBe(secret);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(body).not.toHaveProperty('browserSecret');
    expect(body).not.toHaveProperty('browserSecretHash');
    expect(body.miniProgram).not.toHaveProperty('browserSecret');
  });
});
