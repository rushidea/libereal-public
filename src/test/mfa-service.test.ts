// @vitest-environment node

import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createMfaLoginChallenge,
  createMfaSetup,
  confirmMfaSetup,
  disableMfa,
  getMfaStatus,
  isUserMfaEnabled,
  regenerateMfaRecoveryCodes,
  setMfaRateLimitStoreForTests,
  verifyMfaLoginChallenge,
} from '@/lib/security/mfa-service';
import { createMemoryMfaRateLimitStore } from '@/lib/security/mfa-rate-limit';
import { backfillAuthenticators, hasUnifiedTables } from '@/lib/security/unified-authenticator-store';
import { totpCodeAt } from '@/lib/security/mfa-totp';

function createMfaSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE User (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT);
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
    CREATE TABLE MfaRecoveryCode (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      codeHash TEXT NOT NULL,
      usedAt TEXT,
      createdAt TEXT NOT NULL
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

describe('production MFA service flow', () => {
  it('runs setup, encrypted confirmation, TOTP challenge verification and one recovery-code use', async () => {
    const dbPath = `/tmp/libereal-mfa-service-${process.pid}-${randomUUID()}.db`;
    const db = new Database(dbPath);
    createMfaSchema(db);
    db.prepare('INSERT INTO User (id, email, name) VALUES (?, ?, ?)').run('user-1', 'test@example.com', 'Test User');
    db.close();

    const previous = {
      databasePath: process.env.DATABASE_PATH,
      enabled: process.env.MFA_PHASE1_ENABLED,
      current: process.env.MFA_KEY_CURRENT,
      key: process.env.MFA_KEY_V1,
      pepper: process.env.MFA_RECOVERY_PEPPER,
    };
    process.env.DATABASE_PATH = dbPath;
    process.env.MFA_PHASE1_ENABLED = 'true';
    process.env.MFA_KEY_CURRENT = '1';
    process.env.MFA_KEY_V1 = randomBytes(32).toString('base64');
    process.env.MFA_RECOVERY_PEPPER = 'test-recovery-pepper';
    setMfaRateLimitStoreForTests(createMemoryMfaRateLimitStore());

    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-06T00:00:00.000Z'));
      const setup = createMfaSetup('user-1');
      expect(setup.otpauthUrl).toContain('otpauth://totp/');
      const pendingDb = new Database(dbPath, { readonly: true });
      const pending = pendingDb.prepare(`
        SELECT enabled, legacy_source_id, key_version FROM user_authenticators
        WHERE user_id = ? AND type = 'totp'
      `).get('user-1') as { enabled: number; legacy_source_id: string; key_version: number };
      expect(pending.enabled).toBe(0);
      expect(pending.legacy_source_id).toBeTruthy();
      expect(pending.key_version).toBe(1);
      pendingDb.close();

      const seedDb = new Database(dbPath);
      seedDb.prepare('INSERT INTO User (id, email, name) VALUES (?, ?, ?)').run('user-2', 'second@example.com', 'Second User');
      seedDb.close();
      const pendingSecond = createMfaSetup('user-2');
      expect(pendingSecond.secret).not.toBe(setup.secret);
      createMfaSetup('user-2');
      const pendingRetryDb = new Database(dbPath, { readonly: true });
      expect(pendingRetryDb.prepare('SELECT COUNT(*) AS count FROM user_authenticators WHERE user_id = ?').get('user-2') as { count: number }).toMatchObject({ count: 1 });
      pendingRetryDb.close();

      const confirmed = await confirmMfaSetup('user-1', totpCodeAt(setup.secret, Date.now()));
      expect(confirmed.recoveryCodes).toHaveLength(10);
      expect(confirmed.recoveryCodes.every((code) => /^[0-9A-F]{16}$/.test(code))).toBe(true);
      expect(getMfaStatus('user-1')).toMatchObject({ enabled: true, confirmedAt: expect.any(String) });
      expect(() => createMfaSetup('user-1')).toThrow('MFA_ALREADY_ENABLED');

      vi.setSystemTime(new Date('2026-08-06T00:00:01.000Z'));
      const totpChallenge = await createMfaLoginChallenge('user-1', 'google');
      const totpResult = await verifyMfaLoginChallenge(totpChallenge.id, totpChallenge.token, {
        code: totpCodeAt(setup.secret, Date.now()),
      });
      expect(totpResult).toMatchObject({ ok: true, login: { userId: 'user-1', mfaMethod: 'totp' } });

      const replayChallenge = await createMfaLoginChallenge('user-1', 'credentials');
      expect(await verifyMfaLoginChallenge(replayChallenge.id, replayChallenge.token, {
        code: totpCodeAt(setup.secret, Date.now()),
      })).toMatchObject({ ok: false, reason: 'replay' });

      const recoveryChallenge = await createMfaLoginChallenge('user-1', 'wechat-mini');
      const recoveryResult = await verifyMfaLoginChallenge(recoveryChallenge.id, recoveryChallenge.token, {
        recoveryCode: confirmed.recoveryCodes[0],
      });
      expect(recoveryResult).toMatchObject({ ok: true, login: { userId: 'user-1', mfaMethod: 'recovery' } });
      const reusedRecovery = await createMfaLoginChallenge('user-1', 'wechat-mini');
      expect(await verifyMfaLoginChallenge(reusedRecovery.id, reusedRecovery.token, {
        recoveryCode: confirmed.recoveryCodes[0],
      })).toMatchObject({ ok: false });

      const verificationDb = new Database(dbPath, { readonly: true });
      const setting = verificationDb.prepare('SELECT lastUsedStep, lastVerifiedAt FROM MfaSetting WHERE userId = ?').get('user-1') as {
        lastUsedStep: number | null;
        lastVerifiedAt: string | null;
      };
      expect(setting.lastUsedStep).not.toBeNull();
      expect(setting.lastVerifiedAt).toBe(new Date('2026-08-06T00:00:01.000Z').toISOString());
      const unifiedSetting = verificationDb.prepare(`
        SELECT last_used_step, enabled, confirmed_at FROM user_authenticators
        WHERE user_id = ? AND type = 'totp'
      `).get('user-1') as { last_used_step: number | null; enabled: number; confirmed_at: string | null };
      expect(unifiedSetting.enabled).toBe(1);
      expect(unifiedSetting.confirmed_at).not.toBeNull();
      expect(unifiedSetting.last_used_step).not.toBeNull();
      expect(verificationDb.prepare('SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ?').get('user-1') as { count: number }).toMatchObject({ count: 10 });
      expect(verificationDb.prepare('SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ? AND used_at IS NOT NULL').get('user-1') as { count: number }).toMatchObject({ count: 1 });
      verificationDb.close();

      const regenerated = regenerateMfaRecoveryCodes('user-1');
      expect(regenerated.recoveryCodes).toHaveLength(10);
      expect(regenerated.recoveryCodes).not.toContain(confirmed.recoveryCodes[0]);

      const authenticatorDb = new Database(dbPath);
      authenticatorDb.prepare(`
        INSERT INTO user_authenticators (id, user_id, type, name, credential_id, created_at, updated_at)
        VALUES (?, ?, 'passkey', '测试通行密钥', ?, datetime('now'), datetime('now'))
      `).run('passkey-1', 'user-1', 'credential-1');
      authenticatorDb.close();
      disableMfa('user-1');
      expect(getMfaStatus('user-1')).toMatchObject({ enabled: false, lastVerifiedAt: null });
      const eventDb = new Database(dbPath, { readonly: true });
      expect((eventDb.prepare('SELECT COUNT(*) AS count FROM SecurityEvent WHERE userId = ?').get('user-1') as { count: number }).count).toBe(7);
      expect(eventDb.prepare('SELECT COUNT(*) AS count FROM user_authenticators WHERE user_id = ? AND enabled = 0').get('user-1') as { count: number }).toMatchObject({ count: 1 });
      expect(eventDb.prepare('SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ?').get('user-1') as { count: number }).toMatchObject({ count: 0 });
      eventDb.close();
    } finally {
      if (previous.databasePath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous.databasePath;
      if (previous.enabled === undefined) delete process.env.MFA_PHASE1_ENABLED;
      else process.env.MFA_PHASE1_ENABLED = previous.enabled;
      if (previous.current === undefined) delete process.env.MFA_KEY_CURRENT;
      else process.env.MFA_KEY_CURRENT = previous.current;
      if (previous.key === undefined) delete process.env.MFA_KEY_V1;
      else process.env.MFA_KEY_V1 = previous.key;
      if (previous.pepper === undefined) delete process.env.MFA_RECOVERY_PEPPER;
      else process.env.MFA_RECOVERY_PEPPER = previous.pepper;
      setMfaRateLimitStoreForTests(null);
      vi.useRealTimers();
    }
  });

  it('backfills legacy MfaSetting and recovery hashes into unified tables idempotently', () => {
    const dbPath = `/tmp/libereal-mfa-backfill-${process.pid}-${randomUUID()}.db`;
    const db = new Database(dbPath);
    db.exec(`
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
      CREATE TABLE MfaRecoveryCode (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        codeHash TEXT NOT NULL,
        usedAt TEXT,
        createdAt TEXT NOT NULL
      );
    `);
    db.prepare(`
      INSERT INTO MfaSetting (id, userId, enabled, required, method, encryptedSecret, secretVersion, lastUsedStep, confirmedAt, lastVerifiedAt, createdAt, updatedAt)
      VALUES ('legacy-1', 'user-1', 1, 0, 'totp', '1:AA:BB:CC', 1, 42, '2026-08-01T00:00:00.000Z', '2026-08-01T00:01:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:01:00.000Z')
    `).run();
    db.prepare(`
      INSERT INTO MfaRecoveryCode (id, userId, codeHash, usedAt, createdAt)
      VALUES ('recovery-1', 'user-1', 'hash-abc', NULL, '2026-08-01T00:00:00.000Z')
    `).run();
    db.exec(`
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

    expect(hasUnifiedTables(db)).toBe(true);
    const first = backfillAuthenticators(db);
    expect(first).toEqual({ authenticatorsCreated: 1, recoveryCodesCopied: 1, skippedExisting: 0, conflicts: 0 });
    const second = backfillAuthenticators(db);
    expect(second).toEqual({ authenticatorsCreated: 0, recoveryCodesCopied: 0, skippedExisting: 1, conflicts: 0 });
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run('user-1');
    const repaired = backfillAuthenticators(db);
    expect(repaired).toEqual({ authenticatorsCreated: 0, recoveryCodesCopied: 1, skippedExisting: 1, conflicts: 0 });
    const repairedAgain = backfillAuthenticators(db);
    expect(repairedAgain).toEqual({ authenticatorsCreated: 0, recoveryCodesCopied: 0, skippedExisting: 1, conflicts: 0 });

    const authenticator = db.prepare(`
      SELECT legacy_source_id, last_used_step, confirmed_at, enabled, key_version, encrypted_secret, secret_iv, secret_auth_tag
      FROM user_authenticators WHERE legacy_source_id = 'legacy-1'
    `).get() as { legacy_source_id: string; last_used_step: number; confirmed_at: string; enabled: number; key_version: number; encrypted_secret: string; secret_iv: string; secret_auth_tag: string };
    expect(authenticator).toMatchObject({
      legacy_source_id: 'legacy-1',
      last_used_step: 42,
      confirmed_at: '2026-08-01T00:00:00.000Z',
      enabled: 1,
      key_version: 1,
      encrypted_secret: 'BB',
      secret_iv: 'AA',
      secret_auth_tag: 'CC',
    });
    const recovery = db.prepare(`
      SELECT code_hash, pepper_version, authenticator_id FROM recovery_codes WHERE user_id = 'user-1'
    `).get() as { code_hash: string; pepper_version: number; authenticator_id: string };
    expect(recovery.code_hash).toBe('hash-abc');
    expect(recovery.pepper_version).toBe(1);
    expect(recovery.authenticator_id).toBeTruthy();
    db.close();
  });

  it('fails closed when legacy and unified MFA status rows disagree', () => {
    const dbPath = `/tmp/libereal-mfa-conflict-${process.pid}-${randomUUID()}.db`;
    const db = new Database(dbPath);
    createMfaSchema(db);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO MfaSetting (id, userId, enabled, required, method, encryptedSecret, secretVersion, confirmedAt, createdAt, updatedAt) VALUES (?, ?, 1, 0, \'totp\', ?, 1, ?, ?, ?)').run(
      'legacy-conflict',
      'user-conflict',
      '1:AA:BB:CC',
      now,
      now,
      now,
    );
    db.prepare('INSERT INTO user_authenticators (id, user_id, type, enabled, confirmed_at, created_at, updated_at) VALUES (?, ?, \'totp\', 0, ?, ?, ?)').run(
      'unified-conflict',
      'user-conflict',
      now,
      now,
      now,
    );
    db.close();

    const previous = {
      databasePath: process.env.DATABASE_PATH,
      enabled: process.env.MFA_PHASE1_ENABLED,
    };
    process.env.DATABASE_PATH = dbPath;
    process.env.MFA_PHASE1_ENABLED = 'true';
    try {
      expect(() => getMfaStatus('user-conflict')).toThrow('AUTHENTICATOR_DATA_CONFLICT');
    } finally {
      if (previous.databasePath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous.databasePath;
      if (previous.enabled === undefined) delete process.env.MFA_PHASE1_ENABLED;
      else process.env.MFA_PHASE1_ENABLED = previous.enabled;
    }
  });

  it('requires MFA for a passkey-only unified account', () => {
    const dbPath = `/tmp/libereal-mfa-passkey-only-${process.pid}-${randomUUID()}.db`;
    const db = new Database(dbPath);
    createMfaSchema(db);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO user_authenticators (id, user_id, type, enabled, created_at, updated_at) VALUES (?, ?, \'passkey\', 1, ?, ?)').run(
      'passkey-only',
      'user-passkey-only',
      now,
      now,
    );
    db.close();

    const previous = {
      databasePath: process.env.DATABASE_PATH,
      enabled: process.env.MFA_PHASE1_ENABLED,
    };
    process.env.DATABASE_PATH = dbPath;
    process.env.MFA_PHASE1_ENABLED = 'true';
    try {
      expect(isUserMfaEnabled('user-passkey-only')).toBe(true);
    } finally {
      if (previous.databasePath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous.databasePath;
      if (previous.enabled === undefined) delete process.env.MFA_PHASE1_ENABLED;
      else process.env.MFA_PHASE1_ENABLED = previous.enabled;
    }
  });
});
