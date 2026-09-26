/**
 * Isolated Phase 1.5 migration drill (forward + rollback + consistency).
 *
 * Creates a temporary SQLite database with the legacy MFA tables, snapshots it
 * (backup + SHA-256), applies the unified authenticator migration SQL, runs the
 * idempotent backfill, verifies unified/legacy consistency, then restores the
 * backup and confirms the legacy-only path still reads correctly.
 *
 * This never touches prisma/dev.db or any staging/production database.
 */
import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { backfillAuthenticators, hasUnifiedTables, verifyUnifiedConsistency } from '../src/lib/security/unified-authenticator-store';

const MIGRATION_SQL = resolve(process.cwd(), 'prisma/migrations/20260807100000_add_unified_authenticator_tables/migration.sql');

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function createLegacySchema(db: Database.Database): void {
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

function fail(message: string): never {
  console.error(`[drill] FAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

const tempDir = mkdtempSync(join(tmpdir(), 'libereal-mfa-drill-'));
const dbPath = join(tempDir, 'drill.db');
const backupPath = join(tempDir, 'drill.backup.db');
const db = new Database(dbPath);
try {
  createLegacySchema(db);
  const now = new Date().toISOString();
  const key = randomBytes(32).toString('base64');
  const iv = randomBytes(12).toString('base64url');
  const ciphertext = randomBytes(20).toString('base64url');
  const tag = randomBytes(16).toString('base64url');
  const envelope = `1:${iv}:${ciphertext}:${tag}`;
  db.prepare('INSERT INTO User (id, email, name) VALUES (?, ?, ?)').run('user-1', 'drill@example.com', 'Drill');
  db.prepare(`
    INSERT INTO MfaSetting (id, userId, enabled, required, method, encryptedSecret, secretVersion, lastUsedStep, confirmedAt, lastVerifiedAt, createdAt, updatedAt)
    VALUES (?, ?, 1, 0, 'totp', ?, 1, 42, ?, ?, ?, ?)
  `).run('legacy-1', 'user-1', envelope, now, now, now, now);
  db.prepare(`
    INSERT INTO MfaRecoveryCode (id, userId, codeHash, usedAt, createdAt)
    VALUES (?, ?, ?, NULL, ?)
  `).run('recovery-1', 'user-1', createHash('sha256').update(`code-${key}`).digest('hex'), now);
  db.prepare(`
    INSERT INTO MfaChallenge (id, userId, challengeHash, purpose, provider, expiresAt, attemptCount, consumedAt, createdAt)
    VALUES (?, ?, ?, 'login', 'credentials', ?, 0, NULL, ?)
  `).run(randomUUID(), 'user-1', createHash('sha256').update('token').digest('hex'), new Date(Date.now() + 300_000).toISOString(), now);
  db.close();

  copyFileSync(dbPath, backupPath);
  const backupHash = sha256File(backupPath);
  console.log(`[drill] backup=${backupPath} sha256=${backupHash.slice(0, 16)}… size=${statSync(backupPath).size}`);

  const migrated = new Database(dbPath);
  migrated.exec(readFileSync(MIGRATION_SQL, 'utf8'));
  if (!hasUnifiedTables(migrated)) fail('migration did not create unified tables');

  const first = backfillAuthenticators(migrated);
  if (first.authenticatorsCreated !== 1 || first.recoveryCodesCopied !== 1 || first.conflicts !== 0) {
    fail(`unexpected first backfill summary: ${JSON.stringify(first)}`);
  }
  const second = backfillAuthenticators(migrated);
  if (second.skippedExisting !== 1 || second.authenticatorsCreated !== 0) {
    fail(`backfill is not idempotent: ${JSON.stringify(second)}`);
  }

  const report = verifyUnifiedConsistency(migrated);
  if (!report.ok) fail(`consistency check failed: ${report.errors.join(', ')}`);
  console.log(`[drill] forward ok: authenticators=${report.checkedAuthenticators} recovery=${report.checkedRecoveryCodes}`);
  migrated.close();

  // Rollback: restore the pre-migration backup; legacy path must remain readable.
  copyFileSync(backupPath, dbPath);
  const restored = new Database(dbPath, { readonly: true });
  const legacySetting = restored.prepare('SELECT id, enabled FROM MfaSetting WHERE userId = ?').get('user-1') as { id: string; enabled: number };
  if (!legacySetting || legacySetting.enabled !== 1 || hasUnifiedTables(restored)) {
    fail('restored legacy database is not readable or unified tables leaked');
  }
  console.log(`[drill] rollback ok: legacy MfaSetting id=${legacySetting.id} enabled=${legacySetting.enabled}`);
  restored.close();
  console.log(`[drill] PASS key=${key.length} bytes`);
} finally {
  try {
    if (!db.open) db.close();
  } catch {}
  rmSync(tempDir, { recursive: true, force: true });
}
