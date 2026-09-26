// @vitest-environment node

import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createMfaRecoveryPepperRing,
  createMfaKeyRing,
  decryptMfaSecret,
  encryptMfaSecret,
  hashMfaRecoveryCode,
  hashMfaRecoveryCodeWithVersion,
  reencryptMfaSecret,
} from '@/lib/security/mfa-crypto';
import {
  consumeMfaChallenge,
  createMfaChallenge,
  hashChallengeForStorage,
  recordMfaFailure,
} from '@/lib/security/mfa-challenge-store';

function createSecurityTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE MfaSetting (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL UNIQUE,
      enabled BOOLEAN NOT NULL DEFAULT 0,
      lastUsedStep INTEGER,
      lastVerifiedAt TEXT,
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
    CREATE TABLE user_authenticators (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT 1,
      last_used_step INTEGER,
      last_used_at TEXT
    );
  `);
}

describe('MFA security foundation', () => {
  it('encrypts versioned TOTP secrets and hashes normalized recovery codes', () => {
    const v1 = randomBytes(32);
    const v2 = randomBytes(32);
    const firstRing = createMfaKeyRing({ currentVersion: 1, keys: { 1: v1 } });
    const rotatedRing = createMfaKeyRing({ currentVersion: 2, keys: { 1: v1, 2: v2 } });
    const encrypted = encryptMfaSecret('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', firstRing);

    expect(encrypted.split(':')).toHaveLength(4);
    expect(decryptMfaSecret(encrypted, firstRing)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');

    const rotated = reencryptMfaSecret(encrypted, rotatedRing);
    expect(rotated).not.toBe(encrypted);
    expect(rotated.startsWith('2:')).toBe(true);
    expect(decryptMfaSecret(rotated, rotatedRing)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');

    const hashA = hashMfaRecoveryCode(' abcd-1234 ', 'test-pepper');
    const hashB = hashMfaRecoveryCode('ABCD1234', 'test-pepper');
    expect(hashA).toBe(hashB);
    expect(encrypted).not.toContain('GEZDGNBVGY3TQ');
  });

  it('supports versioned recovery-code peppers without exposing pepper values', () => {
    const ring = createMfaRecoveryPepperRing({ currentVersion: 2, peppers: { 1: 'old-pepper', 2: 'new-pepper' } });
    expect(ring.currentVersion).toBe(2);
    expect(hashMfaRecoveryCodeWithVersion('abcd-1234', ring.peppers.get(2)!, 2)).toMatch(/^v2:[0-9a-f]{64}$/);
    expect(hashMfaRecoveryCodeWithVersion('abcd-1234', ring.peppers.get(1)!, 1)).not.toBe(hashMfaRecoveryCodeWithVersion('abcd-1234', ring.peppers.get(2)!, 2));
  });

  it('stores only the challenge digest and atomically consumes a TOTP step once', () => {
    const db = new Database(':memory:');
    createSecurityTables(db);
    const now = new Date('2026-08-06T00:00:00.000Z');
    db.prepare(`
      INSERT INTO MfaSetting (id, userId, enabled, lastUsedStep, lastVerifiedAt, updatedAt)
      VALUES (?, ?, 1, NULL, NULL, ?)
    `).run('setting-1', 'user-1', now.toISOString());

    const challenge = createMfaChallenge(db, {
      userId: 'user-1',
      purpose: 'login',
      provider: 'google',
      now,
    });
    const stored = db.prepare('SELECT challengeHash FROM MfaChallenge WHERE id = ?').get(challenge.id) as { challengeHash: string };
    expect(stored.challengeHash).toBe(hashChallengeForStorage(challenge.token));
    expect(stored.challengeHash).not.toBe(challenge.token);

    expect(consumeMfaChallenge(db, {
      token: challenge.token,
      userId: 'user-1',
      purpose: 'login',
      provider: 'google',
      matchedStep: 100,
      now,
    })).toEqual({ ok: true, userId: 'user-1', matchedStep: 100 });

    expect(consumeMfaChallenge(db, {
      token: challenge.token,
      userId: 'user-1',
      purpose: 'login',
      provider: 'google',
      matchedStep: 100,
      now,
    })).toEqual({ ok: false, reason: 'consumed' });
    db.close();
  });

  it('limits failed attempts and rejects provider or user mismatch', () => {
    const db = new Database(':memory:');
    createSecurityTables(db);
    const now = new Date('2026-08-06T00:00:00.000Z');
    const challenge = createMfaChallenge(db, {
      userId: 'user-1',
      purpose: 'login',
      provider: 'wechat-mini',
      now,
    });

    expect(consumeMfaChallenge(db, {
      token: challenge.token,
      userId: 'user-2',
      purpose: 'login',
      provider: 'wechat-mini',
      matchedStep: 1,
      now,
    })).toEqual({ ok: false, reason: 'mismatch' });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = recordMfaFailure(db, {
        token: challenge.token,
        userId: 'user-1',
        purpose: 'login',
        provider: 'wechat-mini',
        now,
      });
      expect(result.attemptCount).toBe(attempt);
      expect(result.accepted).toBe(true);
    }
    expect(recordMfaFailure(db, {
      token: challenge.token,
      userId: 'user-1',
      purpose: 'login',
      provider: 'wechat-mini',
      now,
    })).toEqual({ accepted: false, attemptCount: 5, locked: true });
    db.close();
  });

  it('falls back to the legacy replay state when unified tables exist but the account is not backfilled yet', () => {
    const db = new Database(':memory:');
    createSecurityTables(db);
    const now = new Date('2026-08-06T00:00:00.000Z');
    db.prepare(`
      INSERT INTO MfaSetting (id, userId, enabled, lastUsedStep, lastVerifiedAt, updatedAt)
      VALUES (?, ?, 1, NULL, NULL, ?)
    `).run('legacy-setting', 'user-1', now.toISOString());
    const challenge = createMfaChallenge(db, { userId: 'user-1', purpose: 'login', provider: 'google', now });

    expect(consumeMfaChallenge(db, {
      token: challenge.token,
      userId: 'user-1',
      purpose: 'login',
      provider: 'google',
      matchedStep: 200,
      now,
    })).toEqual({ ok: true, userId: 'user-1', matchedStep: 200 });
    db.close();
  });
});
