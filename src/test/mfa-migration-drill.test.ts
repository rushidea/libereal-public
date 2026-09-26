// @vitest-environment node

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { backfillAuthenticators, hasUnifiedTables } from '@/lib/security/unified-authenticator-store';

const MIGRATION_SQL = fs.readFileSync(
  path.join(process.cwd(), 'prisma/migrations/20260807100000_add_unified_authenticator_tables/migration.sql'),
  'utf8',
);

function createLegacyBaseline(db: Database.Database): void {
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
  `);
}

describe('Phase 1.5 isolated migration drill', () => {
  it('applies the append-only migration, backfills idempotently, and keeps legacy data intact for rollback', () => {
    const dbPath = `/tmp/libereal-mfa-migration-drill-${process.pid}-${randomUUID()}.db`;
    const db = new Database(dbPath);
    createLegacyBaseline(db);
    db.prepare('INSERT INTO User (id, email, name) VALUES (?, ?, ?)').run('user-1', 'test@example.com', 'User One');
    db.prepare(`
      INSERT INTO MfaSetting (id, userId, enabled, required, method, encryptedSecret, secretVersion, lastUsedStep, confirmedAt, lastVerifiedAt, createdAt, updatedAt)
      VALUES ('legacy-1', 'user-1', 1, 0, 'totp', '2:iv:ct:tag', 2, 7, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:10.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:10.000Z')
    `).run();
    db.prepare(`
      INSERT INTO MfaRecoveryCode (id, userId, codeHash, usedAt, createdAt)
      VALUES ('recovery-1', 'user-1', 'hash-1', NULL, '2026-08-01T00:00:00.000Z')
    `).run();
    db.prepare(`
      INSERT INTO MfaRecoveryCode (id, userId, codeHash, usedAt, createdAt)
      VALUES ('recovery-2', 'user-1', 'hash-2', '2026-08-02T00:00:00.000Z', '2026-08-01T00:00:00.000Z')
    `).run();

    // Apply the actual append-only migration SQL.
    db.exec(MIGRATION_SQL);
    expect(hasUnifiedTables(db)).toBe(true);

    const first = backfillAuthenticators(db);
    expect(first).toEqual({ authenticatorsCreated: 1, recoveryCodesCopied: 2, skippedExisting: 0, conflicts: 0 });
    const second = backfillAuthenticators(db);
    expect(second).toEqual({ authenticatorsCreated: 0, recoveryCodesCopied: 0, skippedExisting: 1, conflicts: 0 });

    const authenticator = db.prepare(`
      SELECT legacy_source_id, key_version, encrypted_secret, secret_iv, secret_auth_tag, last_used_step, confirmed_at, enabled
      FROM user_authenticators WHERE legacy_source_id = 'legacy-1'
    `).get() as {
      legacy_source_id: string;
      key_version: number;
      encrypted_secret: string;
      secret_iv: string;
      secret_auth_tag: string;
      last_used_step: number;
      confirmed_at: string;
      enabled: number;
    };
    expect(authenticator).toMatchObject({
      legacy_source_id: 'legacy-1',
      key_version: 2,
      encrypted_secret: 'ct',
      secret_iv: 'iv',
      secret_auth_tag: 'tag',
      last_used_step: 7,
      confirmed_at: '2026-08-01T00:00:00.000Z',
      enabled: 1,
    });

    const recoveryRows = db.prepare(`
      SELECT code_hash, pepper_version, used_at FROM recovery_codes WHERE user_id = 'user-1' ORDER BY code_hash
    `).all() as Array<{ code_hash: string; pepper_version: number; used_at: string | null }>;
    expect(recoveryRows).toEqual([
      { code_hash: 'hash-1', pepper_version: 1, used_at: null },
      { code_hash: 'hash-2', pepper_version: 1, used_at: '2026-08-02T00:00:00.000Z' },
    ]);

    // Legacy rows remain untouched, proving old-code rollback can keep reading them.
    const legacySetting = db.prepare('SELECT encryptedSecret, lastUsedStep FROM MfaSetting WHERE id = ?').get('legacy-1') as {
      encryptedSecret: string;
      lastUsedStep: number;
    };
    expect(legacySetting).toEqual({ encryptedSecret: '2:iv:ct:tag', lastUsedStep: 7 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM MfaRecoveryCode WHERE userId = ?').get('user-1') as { count: number }).toMatchObject({ count: 2 });
    db.close();
  });
});
