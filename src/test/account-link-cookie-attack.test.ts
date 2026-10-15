import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ACCOUNT_LINK_COOKIE, MERGE_VERIFIED_COOKIE, PENDING_OAUTH_COOKIE } from '@/lib/auth-helpers';
import { clearAllTables, closeTestDb, getTestDb, seedUserWithPassword } from './db-helpers';

const cookieJar = new Map<string, string>();

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

import { GET as mergeGET, POST as mergePOST } from '@/app/api/account/merge/route';
import {
  ACCOUNT_LINK_STATE_PREFIX,
  consumeAccountLinkIntent,
  consumePendingOAuthLinkValue,
  createAccountLinkIntent,
  createPendingOAuthLink,
  PENDING_OAUTH_STATE_PREFIX,
  readPendingOAuthLinkValue,
  saveAccountLinkIntent,
  savePendingOAuthLink,
  setAccountLinkIntentCookie,
  setAccountLinkStateStoreForTests,
  shouldIssueSessionForProviderLink,
  upgradePendingOAuthToMerge,
  type AccountLinkSession,
} from '@/lib/account-linking';

const victim: AccountLinkSession = { userId: 'victim-user', sessionId: 'victim-session' };

function memoryStore() {
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

function forgedUnsignedCookie(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function opaqueId(): string {
  return randomBytes(32).toString('base64url');
}

describe('account link cookie attacks', () => {
  const store = memoryStore();

  beforeEach(() => {
    cookieJar.clear();
    store.clear();
    setAccountLinkStateStoreForTests(store);
  });

  it('rejects a forged unsigned account-link-intent for a logged-out attacker', async () => {
    const forged = forgedUnsignedCookie({
      userId: victim.userId,
      provider: 'google',
      exp: Date.now() + 10 * 60 * 1000,
    });

    await expect(consumeAccountLinkIntent(forged, 'google', null)).resolves.toBeNull();
    await expect(consumeAccountLinkIntent(forged, 'wechat', null)).resolves.toBeNull();
  });

  it('rejects a forged unsigned account-link-intent even when the victim session is presented', async () => {
    const forged = forgedUnsignedCookie({
      userId: victim.userId,
      provider: 'google',
      sessionId: victim.sessionId,
      exp: Date.now() + 10 * 60 * 1000,
    });

    await expect(consumeAccountLinkIntent(forged, 'google', victim)).resolves.toBeNull();
    await expect(consumeAccountLinkIntent(opaqueId(), 'google', victim)).resolves.toBeNull();
  });

  it('does not put the user id in the cookie and refuses logged-out, mismatched, tampered, and replayed use', async () => {
    const intent = createAccountLinkIntent(
      victim.userId,
      'google',
      victim.sessionId,
      '/account/settings?oauthLink=success',
    );
    await setAccountLinkIntentCookie(intent);
    const cookieValue = cookieJar.get(ACCOUNT_LINK_COOKIE);
    expect(cookieValue).toBeTruthy();
    expect(cookieValue).not.toContain(victim.userId);
    expect(forgedUnsignedCookie({ userId: victim.userId })).not.toBe(cookieValue);

    await expect(consumeAccountLinkIntent(cookieValue, 'google', null)).resolves.toBeNull();
    await expect(consumeAccountLinkIntent(cookieValue, 'google', {
      userId: 'attacker',
      sessionId: 'attacker-session',
    })).resolves.toBeNull();
    await expect(consumeAccountLinkIntent(cookieValue, 'wechat', victim)).resolves.toBeNull();

    const tampered = `${cookieValue!.slice(0, -1)}${cookieValue!.endsWith('a') ? 'b' : 'a'}`;
    await expect(consumeAccountLinkIntent(tampered, 'google', victim)).resolves.toBeNull();

    const authorized = await consumeAccountLinkIntent(cookieValue, 'google', victim);
    expect(authorized?.userId).toBe(victim.userId);
    expect(authorized?.sessionId).toBe(victim.sessionId);
    expect(authorized?.callbackUrl).toBe('/account/settings?oauthLink=success');

    await expect(consumeAccountLinkIntent(cookieValue, 'google', victim)).resolves.toBeNull();
  });

  it('rejects an expired server-side link intent', async () => {
    const id = opaqueId();
    await store.set(ACCOUNT_LINK_STATE_PREFIX + id, JSON.stringify({
      userId: victim.userId,
      sessionId: victim.sessionId,
      provider: 'wechat',
      exp: Date.now() - 1000,
    }), 60_000);

    await expect(consumeAccountLinkIntent(id, 'wechat', victim)).resolves.toBeNull();
  });

  it('drops callback urls that are not same-origin paths', async () => {
    const id = await saveAccountLinkIntent(createAccountLinkIntent(
      victim.userId,
      'google',
      victim.sessionId,
      'https://evil.example/phish',
    ));
    const authorized = await consumeAccountLinkIntent(id, 'google', victim);
    expect(authorized?.callbackUrl).toBeUndefined();
  });

  it('does not issue a session when provider linking still requires login MFA', () => {
    expect(shouldIssueSessionForProviderLink(true)).toBe(true);
    expect(shouldIssueSessionForProviderLink('/login/mfa?challengeId=abc&provider=google')).toBe(false);
    expect(shouldIssueSessionForProviderLink('/login?error=MfaUnavailable')).toBe(false);

    const source = readFileSync(path.join(process.cwd(), 'src/lib/auth.ts'), 'utf8');
    expect(source).toContain('consumeAccountLinkIntentForSession');
    expect(source).toContain('shouldIssueSessionForProviderLink');
    expect(source).not.toMatch(/clearAccountLinkIntentCookie\(\);\s*return true;/);
    expect(source).not.toContain('readAccountLinkIntentCookie');
  });

  it('rejects a forged pending-oauth-link and does not let the cookie choose the target user', async () => {
    const forged = forgedUnsignedCookie({
      provider: 'google',
      providerAccountId: 'attacker-google-sub',
      mode: 'merge',
      targetUserId: victim.userId,
      exp: Date.now() + 15 * 60 * 1000,
    });
    await expect(readPendingOAuthLinkValue(forged)).resolves.toBeNull();
    await expect(consumePendingOAuthLinkValue(forged)).resolves.toBeNull();

    const stateId = await savePendingOAuthLink(createPendingOAuthLink(
      { provider: 'google', providerAccountId: 'attacker-google-sub' },
      'google',
      { mode: 'merge', targetUserId: victim.userId, oauthEmail: 'victim@example.com' },
    ));
    expect(stateId).not.toContain(victim.userId);
    const pending = await readPendingOAuthLinkValue(stateId);
    expect(pending?.targetUserId).toBe(victim.userId);

    const swapped = forgedUnsignedCookie({
      ...pending,
      targetUserId: 'other-user',
    });
    await expect(readPendingOAuthLinkValue(swapped)).resolves.toBeNull();
    await expect(readPendingOAuthLinkValue(stateId)).resolves.toMatchObject({ targetUserId: victim.userId });
  });

  it('rejects a replayed pending oauth link after it is consumed', async () => {
    const stateId = await savePendingOAuthLink(createPendingOAuthLink(
      { provider: 'wechat', providerAccountId: 'wx-attacker' },
      'wechat',
      { mode: 'register' },
    ));
    const upgraded = upgradePendingOAuthToMerge((await readPendingOAuthLinkValue(stateId))!, victim.userId);
    await savePendingOAuthLink(upgraded);

    const first = await consumePendingOAuthLinkValue(stateId);
    expect(first?.mode).toBe('merge');
    expect(first?.targetUserId).toBe(victim.userId);
    await expect(consumePendingOAuthLinkValue(stateId)).resolves.toBeNull();
    await expect(readPendingOAuthLinkValue(stateId)).resolves.toBeNull();
  });

  it('does not treat a pending oauth id as an account-link intent', async () => {
    const stateId = await savePendingOAuthLink(createPendingOAuthLink(
      { provider: 'google', providerAccountId: 'gid' },
      'google',
      { mode: 'merge', targetUserId: victim.userId },
    ));
    await expect(consumeAccountLinkIntent(stateId, 'google', victim)).resolves.toBeNull();
    expect(await store.get(PENDING_OAUTH_STATE_PREFIX + stateId)).toBeTruthy();
  });
});

describe('POST /api/account/merge forged pending cookie', () => {
  const store = memoryStore();

  beforeAll(() => {
    getTestDb();
  });

  afterAll(() => {
    closeTestDb();
    setAccountLinkStateStoreForTests(null);
  });

  beforeEach(async () => {
    cookieJar.clear();
    store.clear();
    setAccountLinkStateStoreForTests(store);
    clearAllTables(getTestDb());
    const hash = await bcrypt.hash('correct-password', 12);
    seedUserWithPassword(getTestDb(), {
      id: 'usr_victim',
      email: 'victim@example.com',
      passwordHash: hash,
    });
  });

  function mergeRequest(password = 'correct-password') {
    return new NextRequest('http://localhost:3000/api/account/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  }

  it('does not link an account or prepare a session when the pending cookie is forged', async () => {
    cookieJar.set(PENDING_OAUTH_COOKIE, forgedUnsignedCookie({
      provider: 'google',
      providerAccountId: 'attacker-google-sub',
      mode: 'merge',
      targetUserId: 'usr_victim',
      oauthEmail: 'victim@example.com',
      exp: Date.now() + 15 * 60 * 1000,
    }));

    const response = await mergePOST(mergeRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBeUndefined();
    expect(cookieJar.get(MERGE_VERIFIED_COOKIE)).toBeUndefined();
    const accounts = getTestDb().prepare('SELECT id FROM Account').all();
    expect(accounts).toEqual([]);
  });

  it('does not reveal the target account from a forged pending cookie', async () => {
    cookieJar.set(PENDING_OAUTH_COOKIE, forgedUnsignedCookie({
      provider: 'wechat',
      providerAccountId: 'wx-attacker',
      mode: 'merge',
      targetUserId: 'usr_victim',
      exp: Date.now() + 15 * 60 * 1000,
    }));

    const response = await mergeGET();
    const body = await response.json();
    expect(body).toEqual({ pending: null });
    expect(JSON.stringify(body)).not.toContain('victim@example.com');
    expect(JSON.stringify(body)).not.toContain('usr_victim');
  });

  it('links once from server state and rejects a replay of the same cookie', async () => {
    const stateId = await savePendingOAuthLink(createPendingOAuthLink(
      { provider: 'google', providerAccountId: 'attacker-google-sub' },
      'google',
      { mode: 'merge', targetUserId: 'usr_victim', oauthEmail: 'victim@example.com' },
    ));
    cookieJar.set(PENDING_OAUTH_COOKIE, stateId);

    const first = await mergePOST(mergeRequest());
    expect(first.status).toBe(200);
    expect(cookieJar.get(MERGE_VERIFIED_COOKIE)).toBe('usr_victim');
    const linked = getTestDb().prepare(
      'SELECT userId, providerAccountId FROM Account WHERE provider = ?',
    ).get('google') as { userId: string; providerAccountId: string };
    expect(linked).toEqual({ userId: 'usr_victim', providerAccountId: 'attacker-google-sub' });

    cookieJar.set(PENDING_OAUTH_COOKIE, stateId);
    cookieJar.delete(MERGE_VERIFIED_COOKIE);
    const replay = await mergePOST(mergeRequest());
    expect(replay.status).toBe(400);
    expect(cookieJar.get(MERGE_VERIFIED_COOKIE)).toBeUndefined();
    const accounts = getTestDb().prepare('SELECT id FROM Account').all();
    expect(accounts).toHaveLength(1);
  });
});
