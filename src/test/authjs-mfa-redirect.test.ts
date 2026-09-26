// @vitest-environment node

import Credentials from 'next-auth/providers/credentials';
import NextAuth from 'next-auth';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

async function assertMfaRedirectContract(providerId: 'google' | 'wechat' | 'wechat-mini') {
    const { handlers } = NextAuth({
      secret: 'phase-1-authjs-test-secret',
      trustHost: true,
      providers: [Credentials({
        id: providerId,
        name: `${providerId}-spike`,
        credentials: { marker: { type: 'text' } },
        async authorize(credentials) {
          return credentials?.marker === 'ok'
            ? { id: 'user-1', email: 'test@example.com' }
            : null;
        },
      })],
      callbacks: {
        async signIn() {
          return '/login/mfa?provider=google';
        },
      },
    });

    const csrfResponse = await handlers.GET(new NextRequest('http://localhost/api/auth/csrf'));
    const csrfCookie = csrfResponse.headers.get('set-cookie') ?? '';
    const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
    const body = new URLSearchParams({
      csrfToken,
      marker: 'ok',
      callbackUrl: 'http://localhost/login',
      json: 'true',
    });

    const response = await handlers.POST(new NextRequest(`http://localhost/api/auth/callback/${providerId}`, {
      method: 'POST',
      headers: {
        cookie: csrfCookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    }));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/login/mfa');
    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).not.toMatch(/(?:__Secure-)?(?:authjs|next-auth)\.session-token=/i);
}

describe('Phase 1 Auth.js MFA redirect contract', () => {
  it.each(['google', 'wechat', 'wechat-mini'] as const)(
    'does not issue a session cookie for %s when signIn returns the MFA page',
    async (providerId) => {
      await assertMfaRedirectContract(providerId);
    },
  );
});
