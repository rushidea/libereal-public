// @vitest-environment node

import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const webauthnMocks = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

const ephemeralStore = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    store: {
      async get(key: string) { return values.get(key) ?? null; },
      async set(key: string, value: string) { values.set(key, value); },
      async delete(key: string) { values.delete(key); },
      async compareAndDelete(key: string, expectedValue: string) {
        if (values.get(key) !== expectedValue) return false;
        values.delete(key);
        return true;
      },
      async increment() { return 1; },
      async acquireLock() { return null; },
      async releaseLock() {},
    },
  };
});

vi.mock('@simplewebauthn/server', () => webauthnMocks);
vi.mock('@/lib/ephemeral-store', () => ({ getEphemeralStore: () => ephemeralStore.store }));

import {
  createDiscoverablePasskeyLoginOptions,
  createPasskeyLoginOptions,
  createPasskeyLoginChallenge,
  createPasskeyRegistrationOptions,
  deletePasskey,
  renamePasskey,
  verifyDiscoverablePasskeyLogin,
  verifyPasskeyLogin,
  verifyPasskeyRegistration,
} from '@/lib/security/passkey-service';
import { consumePasskeyVerifiedToken } from '@/lib/security/passkey-session';
import { hashChallengeForStorage } from '@/lib/security/mfa-challenge-store';

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE User (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT);
    CREATE TABLE TransientEntry (key TEXT PRIMARY KEY, value TEXT NOT NULL, expiresAt TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
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
    CREATE TABLE user_authenticators (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT,
      legacy_source_id TEXT,
      credential_data TEXT,
      credential_id TEXT,
      encrypted_secret TEXT,
      secret_iv TEXT,
      secret_auth_tag TEXT,
      key_version INTEGER,
      last_used_step INTEGER,
      confirmed_at TEXT,
      required BOOLEAN NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT 1,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE recovery_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      authenticator_id TEXT,
      code_hash TEXT NOT NULL,
      pepper_version INTEGER NOT NULL DEFAULT 1,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function insertLoginChallenge(db: Database.Database, userId: string, provider: string): { id: string; token: string } {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO MfaChallenge (id, userId, challengeHash, purpose, provider, expiresAt, createdAt)
    VALUES (?, ?, ?, 'login', ?, ?, ?)
  `).run(id, userId, hashChallengeForStorage(token), provider, new Date(Date.now() + 300_000).toISOString(), now);
  return { id, token };
}

describe('Passkey security flow', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = `/tmp/libereal-passkey-${process.pid}-${randomUUID()}.db`;
    const db = new Database(dbPath);
    createSchema(db);
    db.close();
    ephemeralStore.values.clear();
    webauthnMocks.generateRegistrationOptions.mockReset().mockResolvedValue({ challenge: 'registration-challenge' });
    webauthnMocks.verifyRegistrationResponse.mockReset();
    webauthnMocks.generateAuthenticationOptions.mockReset().mockResolvedValue({ challenge: 'login-challenge' });
    webauthnMocks.verifyAuthenticationResponse.mockReset();
    process.env.DATABASE_PATH = dbPath;
    process.env.WEBAUTHN_RP_ID = 'localhost';
    process.env.WEBAUTHN_ORIGINS = 'http://localhost:3000';
  });

  it('consumes registration options once and rejects duplicate credentials', async () => {
    webauthnMocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'AQID',
          publicKey: Uint8Array.from([4, 5, 6]),
          counter: 0,
          transports: ['internal'],
        },
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
        userVerified: true,
      },
    });

    await createPasskeyRegistrationOptions({ userId: 'user-1', email: 'user@example.com', name: 'User', store: ephemeralStore.store, rateLimitStore: ephemeralStore.store });
    const registrationResponse = { id: 'AQID', response: { transports: ['internal'] } } as never;
    const first = await verifyPasskeyRegistration({ userId: 'user-1', response: registrationResponse, name: 'Laptop', store: ephemeralStore.store });
    expect(first.name).toBe('Laptop');
    expect(webauthnMocks.verifyRegistrationResponse).toHaveBeenCalledWith(expect.objectContaining({
      expectedChallenge: 'registration-challenge',
      expectedOrigin: ['http://localhost:3000'],
      expectedRPID: 'localhost',
      requireUserVerification: true,
    }));
    expect(webauthnMocks.verifyRegistrationResponse).toHaveBeenCalledWith(expect.objectContaining({
      response: registrationResponse,
    }));
    expect(webauthnMocks.generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      userID: new TextEncoder().encode('user-1'),
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    }));

    await expect(verifyPasskeyRegistration({ userId: 'user-1', response: registrationResponse, store: ephemeralStore.store })).rejects.toThrow('PASSKEY_REGISTRATION_EXPIRED');
    await createPasskeyRegistrationOptions({ userId: 'user-1', email: 'user@example.com', name: 'User', store: ephemeralStore.store, rateLimitStore: ephemeralStore.store });
    expect(webauthnMocks.generateRegistrationOptions).toHaveBeenLastCalledWith(expect.objectContaining({
      userID: new TextEncoder().encode('user-1'),
      excludeCredentials: [expect.objectContaining({ id: 'AQID' })],
    }));
    await expect(verifyPasskeyRegistration({ userId: 'user-1', response: registrationResponse, store: ephemeralStore.store })).rejects.toThrow('PASSKEY_CREDENTIAL_EXISTS');
    const db = new Database(dbPath, { readonly: true });
    expect((db.prepare('SELECT COUNT(*) AS count FROM user_authenticators WHERE type = \'passkey\'').get() as { count: number }).count).toBe(1);
    db.close();
  });

  it('binds login to the MFA Challenge and consumes the verified token once', async () => {
    const db = new Database(dbPath);
    db.prepare('INSERT INTO User (id, email, name) VALUES (?, ?, ?)').run('user-1', 'user@example.com', 'User');
    const credentialData = JSON.stringify({ publicKey: 'BAUG', counter: 0, transports: ['internal'] });
    db.prepare(`
      INSERT INTO user_authenticators (id, user_id, type, name, credential_data, credential_id, created_at, updated_at)
      VALUES ('passkey-1', 'user-1', 'passkey', 'Phone', ?, 'AQID', ?, ?)
    `).run(credentialData, new Date().toISOString(), new Date().toISOString());
    const loginChallenge = insertLoginChallenge(db, 'user-1', 'google');
    db.close();

    const options = await createPasskeyLoginOptions({ userId: 'user-1', challengeId: loginChallenge.id, challengeToken: loginChallenge.token, store: ephemeralStore.store });
    expect(options).toMatchObject({ challenge: 'login-challenge' });
    webauthnMocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { credentialID: Uint8Array.from([1, 2, 3]), newCounter: 0, userVerified: true },
    });
    const result = await verifyPasskeyLogin({
      userId: 'user-1',
      provider: 'google',
      challengeId: loginChallenge.id,
      challengeToken: loginChallenge.token,
      response: { id: 'AQID' } as never,
      store: ephemeralStore.store,
      rateLimitStore: ephemeralStore.store,
    });
    const consumed = await consumePasskeyVerifiedToken(result.passkeyToken, loginChallenge.id, loginChallenge.token, ephemeralStore.store);
    expect(consumed).toMatchObject({ userId: 'user-1', email: 'user@example.com' });
    expect(webauthnMocks.verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
      credential: {
        id: 'AQID',
        publicKey: Uint8Array.from([4, 5, 6]),
        counter: 0,
        transports: ['internal'],
      },
    }));
    expect(await consumePasskeyVerifiedToken(result.passkeyToken, loginChallenge.id, loginChallenge.token, ephemeralStore.store)).toBeNull();

    const verificationDb = new Database(dbPath, { readonly: true });
    expect((verificationDb.prepare('SELECT consumedAt FROM MfaChallenge WHERE id = ?').get(loginChallenge.id) as { consumedAt: string | null }).consumedAt).not.toBeNull();
    expect((verificationDb.prepare('SELECT COUNT(*) AS count FROM SecurityEvent WHERE eventType = \'PASSKEY_LOGIN_SUCCESS\'').get() as { count: number }).count).toBe(1);
    verificationDb.close();
  });

  it('creates a login challenge only for an account with an enabled passkey', async () => {
    const db = new Database(dbPath);
    db.prepare('INSERT INTO User (id, email, name) VALUES (?, ?, ?)').run('user-1', 'user@example.com', 'User');
    db.prepare(`
      INSERT INTO user_authenticators (id, user_id, type, name, credential_data, credential_id, created_at, updated_at)
      VALUES ('passkey-1', 'user-1', 'passkey', 'Phone', ?, 'AQID', ?, ?)
    `).run(JSON.stringify({ publicKey: 'BAUG', counter: 0 }), new Date().toISOString(), new Date().toISOString());
    db.close();

    const challenge = await createPasskeyLoginChallenge({ email: 'USER@example.com', ip: '127.0.0.1' });
    expect(challenge.challengeId).toMatch(/^[0-9a-f-]{36}$/i);
    const check = new Database(dbPath, { readonly: true });
    expect(check.prepare('SELECT userId, provider, purpose FROM MfaChallenge WHERE id = ?').get(challenge.challengeId)).toEqual({
      userId: 'user-1',
      provider: 'credentials',
      purpose: 'login',
    });
    check.close();

    await expect(createPasskeyLoginChallenge({ email: 'missing@example.com' })).rejects.toThrow('PASSKEY_LOGIN_USER_NOT_FOUND');
  });

  it('uses a discoverable credential to identify the account without an email', async () => {
    const db = new Database(dbPath);
    db.prepare('INSERT INTO User (id, email, name) VALUES (?, ?, ?)').run('user-1', 'user@example.com', 'User');
    db.prepare(`
      INSERT INTO user_authenticators (id, user_id, type, name, credential_data, credential_id, created_at, updated_at)
      VALUES ('passkey-1', 'user-1', 'passkey', 'Phone', ?, 'AQID', ?, ?)
    `).run(JSON.stringify({ publicKey: 'BAUG', counter: 0, transports: ['internal'] }), new Date().toISOString(), new Date().toISOString());
    db.close();

    const started = await createDiscoverablePasskeyLoginOptions({ store: ephemeralStore.store, rateLimitStore: ephemeralStore.store });
    expect(started.challengeId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(started.options).toMatchObject({ challenge: 'login-challenge' });
    const stored = JSON.parse((await ephemeralStore.store.get(`passkey:discoverable-login:${started.challengeId}`)) ?? '{}') as { challenge?: string };
    expect(stored.challenge).toBe('login-challenge');
    webauthnMocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { credentialID: Uint8Array.from([1, 2, 3]), newCounter: 0, userVerified: true },
    });

    const result = await verifyDiscoverablePasskeyLogin({
      challengeId: started.challengeId,
      response: { id: 'AQID' } as never,
      store: ephemeralStore.store,
      rateLimitStore: ephemeralStore.store,
    });
    expect(result.login).toMatchObject({ userId: 'user-1', email: 'user@example.com' });
    expect(webauthnMocks.verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
      credential: {
        id: 'AQID',
        publicKey: Uint8Array.from([4, 5, 6]),
        counter: 0,
        transports: ['internal'],
      },
    }));
    expect(await consumePasskeyVerifiedToken(result.passkeyToken, result.challengeId, result.challengeToken, ephemeralStore.store)).toMatchObject({ userId: 'user-1' });
  });

  it('renames an enabled passkey and preserves its management history', async () => {
    const db = new Database(dbPath);
    db.prepare('INSERT INTO User (id, email, name) VALUES (?, ?, ?)').run('user-1', 'user@example.com', 'User');
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_authenticators (id, user_id, type, name, credential_data, credential_id, created_at, updated_at)
      VALUES ('passkey-1', 'user-1', 'passkey', 'Phone', ?, 'AQID', ?, ?)
    `).run(JSON.stringify({ publicKey: 'BAUG', counter: 0 }), createdAt, createdAt);
    db.close();

    const renamed = renamePasskey('user-1', 'passkey-1', '实验室手机', '127.0.0.1');
    expect(renamed).toMatchObject({ id: 'passkey-1', name: '实验室手机', createdAt });
    expect(() => renamePasskey('user-1', 'passkey-1', '   ')).toThrow('PASSKEY_NAME_INVALID');
    const check = new Database(dbPath, { readonly: true });
    expect(check.prepare('SELECT name FROM user_authenticators WHERE id = ?').get('passkey-1')).toEqual({ name: '实验室手机' });
    expect((check.prepare("SELECT COUNT(*) AS count FROM SecurityEvent WHERE eventType = 'PASSKEY_RENAMED'").get() as { count: number }).count).toBe(1);
    check.close();
  });

  it('protects the last enabled authenticator during passkey deletion', async () => {
    const db = new Database(dbPath);
    db.prepare('INSERT INTO User (id, email, name) VALUES (?, ?, ?)').run('user-1', 'user@example.com', 'User');
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_authenticators (id, user_id, type, name, credential_data, credential_id, created_at, updated_at)
      VALUES ('passkey-1', 'user-1', 'passkey', 'Phone', ?, 'AQID', ?, ?)
    `).run(JSON.stringify({ publicKey: 'BAUG', counter: 0 }), now, now);
    db.close();

    expect(() => deletePasskey('user-1', 'passkey-1')).toThrow('LAST_AUTHENTICATOR');
    const check = new Database(dbPath, { readonly: true });
    expect((check.prepare("SELECT COUNT(*) AS count FROM user_authenticators WHERE user_id = 'user-1' AND enabled = 1").get() as { count: number }).count).toBe(1);
    check.close();
  });

  it('rejects a non-zero authenticator counter rollback', async () => {
    const db = new Database(dbPath);
    db.prepare('INSERT INTO User (id, email, name) VALUES (?, ?, ?)').run('user-1', 'user@example.com', 'User');
    db.prepare(`
      INSERT INTO user_authenticators (id, user_id, type, credential_data, credential_id, created_at, updated_at)
      VALUES ('passkey-1', 'user-1', 'passkey', ?, 'AQID', ?, ?)
    `).run(JSON.stringify({ publicKey: 'BAUG', counter: 4 }), new Date().toISOString(), new Date().toISOString());
    const loginChallenge = insertLoginChallenge(db, 'user-1', 'credentials');
    db.close();
    await createPasskeyLoginOptions({ userId: 'user-1', challengeId: loginChallenge.id, challengeToken: loginChallenge.token, store: ephemeralStore.store });
    webauthnMocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { credentialID: Uint8Array.from([1, 2, 3]), newCounter: 4, userVerified: true },
    });
    await expect(verifyPasskeyLogin({
      userId: 'user-1',
      provider: 'credentials',
      challengeId: loginChallenge.id,
      challengeToken: loginChallenge.token,
      response: { id: 'AQID' } as never,
      store: ephemeralStore.store,
      rateLimitStore: ephemeralStore.store,
    })).rejects.toThrow('PASSKEY_COUNTER_REPLAY');
  });

  it('locks a passkey challenge after five failed assertions', async () => {
    const db = new Database(dbPath);
    db.prepare('INSERT INTO User (id, email, name) VALUES (?, ?, ?)').run('user-1', 'user@example.com', 'User');
    db.prepare(`
      INSERT INTO user_authenticators (id, user_id, type, credential_data, credential_id, created_at, updated_at)
      VALUES ('passkey-1', 'user-1', 'passkey', ?, 'AQID', ?, ?)
    `).run(JSON.stringify({ publicKey: 'BAUG', counter: 0 }), new Date().toISOString(), new Date().toISOString());
    const loginChallenge = insertLoginChallenge(db, 'user-1', 'credentials');
    db.close();
    webauthnMocks.verifyAuthenticationResponse.mockResolvedValue({ verified: false, authenticationInfo: { newCounter: 0 } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await createPasskeyLoginOptions({ userId: 'user-1', challengeId: loginChallenge.id, challengeToken: loginChallenge.token, store: ephemeralStore.store });
      await expect(verifyPasskeyLogin({
        userId: 'user-1',
        provider: 'credentials',
        challengeId: loginChallenge.id,
        challengeToken: loginChallenge.token,
        response: { id: 'AQID' } as never,
        store: ephemeralStore.store,
        rateLimitStore: ephemeralStore.store,
      })).rejects.toThrow('PASSKEY_LOGIN_INVALID');
    }
    await expect(createPasskeyLoginOptions({ userId: 'user-1', challengeId: loginChallenge.id, challengeToken: loginChallenge.token, store: ephemeralStore.store })).rejects.toThrow('PASSKEY_LOGIN_LOCKED');

    const dbAfterLock = new Database(dbPath);
    dbAfterLock.prepare('UPDATE MfaChallenge SET attemptCount = 5 WHERE id = ?').run(loginChallenge.id);
    dbAfterLock.close();
    ephemeralStore.values.set(`passkey:login:${loginChallenge.id}`, JSON.stringify({ userId: 'user-1', challenge: 'login-challenge' }));
    webauthnMocks.verifyAuthenticationResponse.mockClear();
    await expect(verifyPasskeyLogin({
      userId: 'user-1',
      provider: 'credentials',
      challengeId: loginChallenge.id,
      challengeToken: loginChallenge.token,
      response: { id: 'AQID' } as never,
      store: ephemeralStore.store,
      rateLimitStore: ephemeralStore.store,
    })).rejects.toThrow('PASSKEY_LOGIN_LOCKED');
    expect(webauthnMocks.verifyAuthenticationResponse).not.toHaveBeenCalled();
  });
});
