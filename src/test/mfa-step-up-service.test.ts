// @vitest-environment node

import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptMfaSecret, createMfaKeyRing } from '@/lib/security/mfa-crypto';
import { createMfaStepUpChallenge, setMfaRateLimitStoreForTests, verifyMfaStepUpChallenge } from '@/lib/security/mfa-service';
import { createMemoryMfaRateLimitStore } from '@/lib/security/mfa-rate-limit';
import { generateTotpSecret, totpCodeAt } from '@/lib/security/mfa-totp';

function createSchema(db: Database.Database): void {
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

describe('MFA step-up service', () => {
  it('verifies TOTP and consumes the sensitive-action challenge once', async () => {
    const dbPath = `/tmp/libereal-mfa-step-up-${process.pid}-${randomUUID()}.db`;
    const db = new Database(dbPath);
    createSchema(db);
    const secret = generateTotpSecret();
    const key = randomBytes(32);
    const encryptedSecret = encryptMfaSecret(secret, createMfaKeyRing({ currentVersion: 1, keys: { 1: key } }));
    const now = new Date();
    db.prepare(`
      INSERT INTO MfaSetting (id, userId, enabled, encryptedSecret, secretVersion, createdAt, updatedAt)
      VALUES (?, ?, 1, ?, 1, ?, ?)
    `).run('setting-1', 'user-1', encryptedSecret, now.toISOString(), now.toISOString());
    db.close();

    const previous = {
      databasePath: process.env.DATABASE_PATH,
      enabled: process.env.MFA_PHASE1_ENABLED,
      current: process.env.MFA_KEY_CURRENT,
      key: process.env.MFA_KEY_V1,
    };
    process.env.DATABASE_PATH = dbPath;
    process.env.MFA_PHASE1_ENABLED = 'true';
    process.env.MFA_KEY_CURRENT = '1';
    process.env.MFA_KEY_V1 = key.toString('base64');
    setMfaRateLimitStoreForTests(createMemoryMfaRateLimitStore());

    try {
      const challenge = await createMfaStepUpChallenge('user-1');
      const result = await verifyMfaStepUpChallenge(challenge.id, challenge.token, 'user-1', totpCodeAt(secret, Date.now()));
      expect(result).toMatchObject({ ok: true, verifiedAt: expect.any(Number) });

      const replay = await verifyMfaStepUpChallenge(challenge.id, challenge.token, 'user-1', totpCodeAt(secret, Date.now()));
      expect(replay).toMatchObject({ ok: false, reason: 'consumed', clearCookie: true });

      const verificationDb = new Database(dbPath, { readonly: true });
      expect(verificationDb.prepare('SELECT consumedAt FROM MfaChallenge WHERE id = ?').get(challenge.id)).toMatchObject({ consumedAt: expect.any(String) });
      expect(verificationDb.prepare('SELECT lastUsedStep, lastVerifiedAt FROM MfaSetting WHERE userId = ?').get('user-1')).toMatchObject({ lastUsedStep: expect.any(Number), lastVerifiedAt: expect.any(String) });
      verificationDb.close();
    } finally {
      if (previous.databasePath === undefined) delete process.env.DATABASE_PATH;
      else process.env.DATABASE_PATH = previous.databasePath;
      if (previous.enabled === undefined) delete process.env.MFA_PHASE1_ENABLED;
      else process.env.MFA_PHASE1_ENABLED = previous.enabled;
      if (previous.current === undefined) delete process.env.MFA_KEY_CURRENT;
      else process.env.MFA_KEY_CURRENT = previous.current;
      if (previous.key === undefined) delete process.env.MFA_KEY_V1;
      else process.env.MFA_KEY_V1 = previous.key;
      setMfaRateLimitStoreForTests(null);
    }
  });
});
