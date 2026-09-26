#!/usr/bin/env npx tsx
/**
 * Phase 1.5 backfill: copy enabled MfaSetting rows and recovery hashes into
 * the canonical user_authenticators / recovery_codes tables.
 *
 * Idempotent: rows already carrying legacy_source_id are skipped, so the
 * script can be re-run after partial failures.
 *
 * Output is limited to counts and version/consistency summaries. Secrets,
 * recovery codes and full hashes are never printed.
 */
import Database from 'better-sqlite3';
import { getDatabasePath } from '@/lib/databasePath';
import { backfillAuthenticators, hasUnifiedTables } from '@/lib/security/unified-authenticator-store';

function run(): void {
  const db = new Database(getDatabasePath());
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try {
    if (!hasUnifiedTables(db)) {
      console.error('[backfill-mfa] unified tables missing; run the Prisma migration first.');
      process.exitCode = 2;
      return;
    }
    const summary = backfillAuthenticators(db);
    console.log('[backfill-mfa]', JSON.stringify(summary));
    if (summary.conflicts > 0) process.exitCode = 3;
  } finally {
    db.close();
  }
}

run();
