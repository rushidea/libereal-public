// @vitest-environment node

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const cookieJar = vi.hoisted(() => new Map<string, string>());

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
  headers: vi.fn(async () => new Headers()),
}));

function createAuthGateSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE User (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password TEXT,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'customer',
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE MfaSetting (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL UNIQUE,
      enabled BOOLEAN NOT NULL DEFAULT 0,
      required BOOLEAN NOT NULL DEFAULT 0,
      method TEXT NOT NULL DEFAULT 'totp',
      encryptedSecret TEXT NOT NULL,
      secretVersion INTEGER NOT NULL DEFAULT 1,
      lastUsedStep INTEGER,
      confirmedAt TEXT,
      lastVerifiedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE MfaChallenge (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      challengeHash TEXT NOT NULL UNIQUE,
      purpose TEXT NOT NULL,
      provider TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      attemptCount INTEGER NOT NULL DEFAULT 0,
      consumedAt TEXT,
      createdAt TEXT NOT NULL
    );
  `);
}

describe('real Auth.js wechat-mini MFA gate', () => {
  it('routes a linked mini-program login to MFA without issuing a session cookie', async () => {
    vi.resetModules();
    vi.doMock('@/lib/wechat-mini-auth', () => ({
      WECHAT_MINI_LOGIN_PROVIDER_ID: 'wechat-mini',
      consumeWechatMiniLoginToken: vi.fn(async (loginToken: string) => (
        loginToken === 'mini-login-token'
          ? { id: 'user-1', email: 'mini@example.com', name: 'Mini User' }
          : null
      )),
    }));

    const dbPath = `/tmp/libereal-auth-mfa-mini-${process.pid}-${randomUUID()}.db`;
    const db = new Database(dbPath);
    createAuthGateSchema(db);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO User (id, email, name, updatedAt) VALUES (?, ?, ?, ?)').run(
      'user-1',
      'mini@example.com',
      'Mini User',
      now,
    );
    db.prepare(`
      INSERT INTO MfaSetting
        (id, userId, enabled, required, method, encryptedSecret, secretVersion, createdAt, updatedAt)
      VALUES (?, ?, 1, 0, 'totp', 'test-encrypted-secret', 1, ?, ?)
    `).run('setting-1', 'user-1', now, now);
    db.close();

    const previous = {
      databasePath: process.env.DATABASE_PATH,
      phase1: process.env.MFA_PHASE1_ENABLED,
      authSecret: process.env.AUTH_SECRET,
      authUrl: process.env.AUTH_URL,
      trustHost: process.env.AUTH_TRUST_HOST,
      wechatId: process.env.AUTH_WECHAT_ID,
      wechatSecret: process.env.AUTH_WECHAT_SECRET,
    };
    process.env.DATABASE_PATH = dbPath;
    process.env.MFA_PHASE1_ENABLED = 'true';
    process.env.AUTH_SECRET = 'auth-mfa-mini-isolated-test-secret';
    process.env.AUTH_URL = 'http://localhost:3000';
    process.env.AUTH_TRUST_HOST = 'true';
    process.env.AUTH_WECHAT_ID = 'test-wechat-id';
    process.env.AUTH_WECHAT_SECRET = 'test-wechat-secret';

    let resetMfaRateLimits: (() => void) | undefined;
    try {
      const { createMemoryMfaRateLimitStore } = await import('@/lib/security/mfa-rate-limit');
      const { setMfaRateLimitStoreForTests } = await import('@/lib/security/mfa-service');
      setMfaRateLimitStoreForTests(createMemoryMfaRateLimitStore());
      resetMfaRateLimits = () => setMfaRateLimitStoreForTests(null);
      cookieJar.clear();
      const { handlers } = await import('@/lib/auth');
      const csrfResponse = await handlers.GET(new NextRequest('http://localhost:3000/api/auth/csrf'));
      const csrfToken = (await csrfResponse.json() as { csrfToken: string }).csrfToken;
      const csrfCookie = (csrfResponse.headers.get('set-cookie') ?? '').split(';')[0];
      const response = await handlers.POST(new NextRequest('http://localhost:3000/api/auth/callback/wechat-mini', {
        method: 'POST',
        headers: {
          cookie: csrfCookie,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          csrfToken,
          loginToken: 'mini-login-token',
          callbackUrl: 'http://localhost:3000/account',
          json: 'true',
        }),
      }));

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('/login/mfa');
      expect(response.headers.get('location')).toContain('provider=wechat-mini');
      const setCookie = response.headers.get('set-cookie') ?? '';
      expect(setCookie).not.toMatch(/(?:__Secure-)?(?:authjs|next-auth)\.session-token=/i);
      expect([...cookieJar.keys()].some((key) => key.startsWith('libereal-mfa-challenge-'))).toBe(true);
    } finally {
      vi.doUnmock('@/lib/wechat-mini-auth');
      if (previous.databasePath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous.databasePath;
      if (previous.phase1 === undefined) delete process.env.MFA_PHASE1_ENABLED;
      else process.env.MFA_PHASE1_ENABLED = previous.phase1;
      if (previous.authSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = previous.authSecret;
      if (previous.authUrl === undefined) delete process.env.AUTH_URL;
      else process.env.AUTH_URL = previous.authUrl;
      if (previous.trustHost === undefined) delete process.env.AUTH_TRUST_HOST;
      else process.env.AUTH_TRUST_HOST = previous.trustHost;
      if (previous.wechatId === undefined) delete process.env.AUTH_WECHAT_ID;
      else process.env.AUTH_WECHAT_ID = previous.wechatId;
      if (previous.wechatSecret === undefined) delete process.env.AUTH_WECHAT_SECRET;
      else process.env.AUTH_WECHAT_SECRET = previous.wechatSecret;
      resetMfaRateLimits?.();
    }
  });
});
