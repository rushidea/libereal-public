// @vitest-environment node

import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { hashChallengeForStorage } from '@/lib/security/mfa-challenge-store';

const cookieJar = vi.hoisted(() => new Map<string, string>());
const transientValues = vi.hoisted(() => new Map<string, string>());

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value ? { name, value } : undefined;
    },
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  })),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock('@/lib/ephemeral-store', () => ({
  getEphemeralStore: () => ({
    async get(key: string) { return transientValues.get(key) ?? null; },
    async set(key: string, value: string) { transientValues.set(key, value); },
    async delete(key: string) { transientValues.delete(key); },
    async compareAndDelete(key: string, expectedValue: string) {
      if (transientValues.get(key) !== expectedValue) return false;
      transientValues.delete(key);
      return true;
    },
    async increment() { return 1; },
    async acquireLock() { return null; },
    async releaseLock() {},
  }),
}));

describe('real Auth.js Passkey MFA session gate', () => {
  it('burns a verified token when the MFA challenge cookie is missing', async () => {
    vi.resetModules();
    transientValues.clear();
    const { consumePasskeyVerifiedToken, issuePasskeyVerifiedToken } = await import('@/lib/security/passkey-session');
    const challengeId = randomUUID();
    const token = await issuePasskeyVerifiedToken({
      userId: 'user-1',
      email: 'passkey@example.com',
      name: 'Passkey User',
      challengeId,
      challengeTokenHash: hashChallengeForStorage('cookie-token'),
      mfaVerifiedAt: Date.now(),
    });
    expect(await consumePasskeyVerifiedToken(token, challengeId, '', undefined)).toBeNull();
    expect(await consumePasskeyVerifiedToken(token, challengeId, 'cookie-token', undefined)).toBeNull();
  });

  it('burns a verified token on challenge mismatch and malformed payloads', async () => {
    vi.resetModules();
    transientValues.clear();
    const { consumePasskeyVerifiedToken, issuePasskeyVerifiedToken } = await import('@/lib/security/passkey-session');
    const challengeId = randomUUID();
    const token = await issuePasskeyVerifiedToken({
      userId: 'user-1',
      email: 'passkey@example.com',
      name: 'Passkey User',
      challengeId,
      challengeTokenHash: hashChallengeForStorage('cookie-token'),
      mfaVerifiedAt: Date.now(),
    });
    expect(await consumePasskeyVerifiedToken(token, randomUUID(), 'cookie-token', undefined)).toBeNull();
    expect(await consumePasskeyVerifiedToken(token, challengeId, 'cookie-token', undefined)).toBeNull();

    const malformedToken = await issuePasskeyVerifiedToken({
      userId: 'user-1',
      email: 'passkey@example.com',
      name: 'Passkey User',
      challengeId,
      challengeTokenHash: hashChallengeForStorage('cookie-token'),
      mfaVerifiedAt: Date.now(),
    });
    const malformedKey = `passkey:verified:${createHash('sha256').update(malformedToken).digest('hex')}`;
    transientValues.set(malformedKey, '{malformed');
    expect(await consumePasskeyVerifiedToken(malformedToken, challengeId, 'cookie-token', undefined)).toBeNull();
    expect(transientValues.has(malformedKey)).toBe(false);
  });

  it('issues a session through mfa-verify with mfaMethod=passkey', async () => {
    vi.resetModules();
    const dbPath = `/tmp/libereal-auth-passkey-${process.pid}-${randomUUID()}.db`;
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE User (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, role TEXT NOT NULL DEFAULT 'customer', avatar TEXT, displayAvatarUrl TEXT);
      CREATE TABLE TransientEntry (key TEXT PRIMARY KEY, value TEXT NOT NULL, expiresAt TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE MfaSetting (id TEXT PRIMARY KEY, userId TEXT NOT NULL UNIQUE, enabled BOOLEAN NOT NULL DEFAULT 0);
      CREATE TABLE SecurityEvent (id TEXT PRIMARY KEY, userId TEXT, eventType TEXT NOT NULL, ip TEXT, userAgent TEXT, metadata TEXT, createdAt TEXT NOT NULL);
    `);
    db.prepare('INSERT INTO User (id, email, name) VALUES (?, ?, ?)').run('user-1', 'passkey@example.com', 'Passkey User');
    db.close();

    const previous = {
      databasePath: process.env.DATABASE_PATH,
      authSecret: process.env.AUTH_SECRET,
      authUrl: process.env.AUTH_URL,
      trustHost: process.env.AUTH_TRUST_HOST,
    };
    process.env.DATABASE_PATH = dbPath;
    process.env.AUTH_SECRET = 'auth-passkey-test-secret';
    process.env.AUTH_URL = 'http://localhost:3000';
    process.env.AUTH_TRUST_HOST = 'true';
    try {
      transientValues.clear();
      cookieJar.clear();
      const { issuePasskeyVerifiedToken } = await import('@/lib/security/passkey-session');
      const challengeId = randomUUID();
      const passkeyToken = await issuePasskeyVerifiedToken({
        userId: 'user-1',
        email: 'passkey@example.com',
        name: 'Passkey User',
        challengeId,
        challengeTokenHash: hashChallengeForStorage('cookie-token'),
        mfaVerifiedAt: Date.now(),
      });
      cookieJar.set(`libereal-mfa-challenge-${challengeId}`, 'cookie-token');
      const { handlers } = await import('@/lib/auth');
      const csrfResponse = await handlers.GET(new NextRequest('http://localhost:3000/api/auth/csrf'));
      const csrfToken = (await csrfResponse.json() as { csrfToken: string }).csrfToken;
      const csrfCookie = (csrfResponse.headers.get('set-cookie') ?? '').split(';')[0];
      const response = await handlers.POST(new NextRequest('http://localhost:3000/api/auth/callback/mfa-verify', {
        method: 'POST',
        headers: { cookie: csrfCookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          csrfToken,
          challengeId,
          code: '',
          recoveryCode: '',
          passkeyToken,
          callbackUrl: 'http://localhost:3000/account',
          json: 'true',
        }),
      }));
      expect(response.status).toBe(302);
      expect(response.headers.get('set-cookie') ?? '').toMatch(/(?:authjs|next-auth)\.session-token=/i);
      expect(transientValues.size).toBe(0);
    } finally {
      if (previous.databasePath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous.databasePath;
      if (previous.authSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = previous.authSecret;
      if (previous.authUrl === undefined) delete process.env.AUTH_URL;
      else process.env.AUTH_URL = previous.authUrl;
      if (previous.trustHost === undefined) delete process.env.AUTH_TRUST_HOST;
      else process.env.AUTH_TRUST_HOST = previous.trustHost;
    }
  });
});
