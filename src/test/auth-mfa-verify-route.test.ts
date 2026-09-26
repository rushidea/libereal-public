// @vitest-environment node

import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

function createVerifySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE User (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, updatedAt TEXT NOT NULL);
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
    CREATE TABLE SecurityEvent (
      id TEXT PRIMARY KEY,
      userId TEXT,
      eventType TEXT NOT NULL,
      ip TEXT,
      userAgent TEXT,
      metadata TEXT,
      createdAt TEXT NOT NULL
    );
  `);
}

async function getCsrf(handlers: { GET: (req: NextRequest) => Promise<Response> }): Promise<{ token: string; cookie: string }> {
  const response = await handlers.GET(new NextRequest('http://localhost:3000/api/auth/csrf'));
  const body = await response.json() as { csrfToken: string };
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0];
  return { token: body.csrfToken, cookie };
}

describe('real Auth.js mfa-verify session gate', () => {
  it('issues an mfa_verified session only after a correct TOTP code', async () => {
    vi.resetModules();
    const dbPath = `/tmp/libereal-auth-mfa-verify-${process.pid}-${randomUUID()}.db`;
    const db = new Database(dbPath);
    createVerifySchema(db);
    const key = randomBytes(32).toString('base64');
    process.env.DATABASE_PATH = dbPath;
    process.env.MFA_PHASE1_ENABLED = 'true';
    process.env.MFA_KEY_CURRENT = '1';
    process.env.MFA_KEY_V1 = key;
    process.env.MFA_RECOVERY_PEPPER = 'test-recovery-pepper';
    process.env.AUTH_SECRET = 'auth-mfa-verify-isolated-test-secret';
    process.env.AUTH_URL = 'http://localhost:3000';
    process.env.AUTH_TRUST_HOST = 'true';
    process.env.AUTH_WECHAT_ID = 'test-wechat-id';
    process.env.AUTH_WECHAT_SECRET = 'test-wechat-secret';

    try {
      const { generateTotpSecret, totpCodeAt } = await import('@/lib/security/mfa-totp');
      const { encryptMfaSecret, loadMfaKeyRing } = await import('@/lib/security/mfa-crypto');
      const { hashChallengeForStorage } = await import('@/lib/security/mfa-challenge-store');
      const { setMfaRateLimitStoreForTests } = await import('@/lib/security/mfa-service');
      const { createMemoryMfaRateLimitStore } = await import('@/lib/security/mfa-rate-limit');
      setMfaRateLimitStoreForTests(createMemoryMfaRateLimitStore());

      const secret = generateTotpSecret();
      const envelope = encryptMfaSecret(secret, loadMfaKeyRing());
      const now = new Date();
      db.prepare(`
        INSERT INTO User (id, email, name, updatedAt) VALUES (?, ?, ?, ?)
      `).run('user-1', 'verify@example.com', 'Verify User', now.toISOString());
      db.prepare(`
        INSERT INTO MfaSetting
          (id, userId, enabled, required, method, encryptedSecret, secretVersion, confirmedAt, lastVerifiedAt, createdAt, updatedAt)
        VALUES (?, ?, 1, 0, 'totp', ?, 1, ?, ?, ?, ?)
      `).run('setting-1', 'user-1', envelope, now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString());
      const challengeId = randomUUID();
      const token = randomBytes(32).toString('base64url');
      db.prepare(`
        INSERT INTO MfaChallenge (id, userId, challengeHash, purpose, provider, expiresAt, attemptCount, consumedAt, createdAt)
        VALUES (?, ?, ?, 'login', 'credentials', ?, 0, NULL, ?)
      `).run(challengeId, 'user-1', hashChallengeForStorage(token), new Date(now.getTime() + 5 * 60 * 1000).toISOString(), now.toISOString());
      db.close();

      cookieJar.clear();
      const { handlers } = await import('@/lib/auth');
      const csrf = await getCsrf(handlers);
      cookieJar.set(`libereal-mfa-challenge-${challengeId}`, token);

      const successResponse = await handlers.POST(new NextRequest('http://localhost:3000/api/auth/callback/mfa-verify', {
        method: 'POST',
        headers: { cookie: csrf.cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          csrfToken: csrf.token,
          challengeId,
          code: totpCodeAt(secret, Date.now()),
          recoveryCode: '',
          callbackUrl: 'http://localhost:3000/account',
          json: 'true',
        }),
      }));
      expect(successResponse.status).toBe(302);
      expect(successResponse.headers.get('set-cookie') ?? '').toMatch(/(?:authjs|next-auth)\.session-token=/i);
      const successEventDb = new Database(dbPath, { readonly: true });
      const successEvent = successEventDb.prepare(`
        SELECT eventType FROM SecurityEvent WHERE userId = 'user-1' AND eventType = 'MFA_SUCCESS'
      `).get();
      expect(successEvent).toBeTruthy();
      successEventDb.close();

      // A second attempt with the same (now consumed) challenge must not create a new session.
      const reusedChallengeId = randomUUID();
      const reusedToken = randomBytes(32).toString('base64url');
      const reusedDb = new Database(dbPath);
      reusedDb.prepare(`
        INSERT INTO MfaChallenge (id, userId, challengeHash, purpose, provider, expiresAt, attemptCount, consumedAt, createdAt)
        VALUES (?, ?, ?, 'login', 'credentials', ?, 0, NULL, ?)
      `).run(reusedChallengeId, 'user-1', hashChallengeForStorage(reusedToken), new Date(Date.now() + 5 * 60 * 1000).toISOString(), new Date().toISOString());
      reusedDb.close();
      const csrf2 = await getCsrf(handlers);
      cookieJar.set(`libereal-mfa-challenge-${reusedChallengeId}`, reusedToken);
      const wrongResponse = await handlers.POST(new NextRequest('http://localhost:3000/api/auth/callback/mfa-verify', {
        method: 'POST',
        headers: { cookie: csrf2.cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          csrfToken: csrf2.token,
          challengeId: reusedChallengeId,
          code: '000000',
          recoveryCode: '',
          callbackUrl: 'http://localhost:3000/account',
          json: 'true',
        }),
      }));
      expect(wrongResponse.status).toBe(302);
      expect(wrongResponse.headers.get('set-cookie') ?? '').not.toMatch(/(?:authjs|next-auth)\.session-token=/i);
    } finally {
      delete process.env.DATABASE_PATH;
      delete process.env.MFA_PHASE1_ENABLED;
      delete process.env.MFA_KEY_CURRENT;
      delete process.env.MFA_KEY_V1;
      delete process.env.MFA_RECOVERY_PEPPER;
      delete process.env.AUTH_SECRET;
      delete process.env.AUTH_URL;
      delete process.env.AUTH_TRUST_HOST;
      delete process.env.AUTH_WECHAT_ID;
      delete process.env.AUTH_WECHAT_SECRET;
    }
  });
});
