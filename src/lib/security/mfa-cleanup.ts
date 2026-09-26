import Database from 'better-sqlite3';
import { getDatabasePath } from '@/lib/databasePath';

export interface MfaCleanupSummary {
  consumedDeleted: number;
  expiredDeleted: number;
}

/**
 * Deletes stale MfaChallenge rows. Consumed rows older than 24h and
 * unconsumed expired rows older than 1h are removed. Failure to clean is
 * intentionally non-fatal for the login path.
 */
export function cleanupMfaChallenges(db: Database.Database, now = new Date()): MfaCleanupSummary {
  const consumedBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const expiredBefore = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  const consumedDeleted = db.prepare(`
    DELETE FROM MfaChallenge
    WHERE consumedAt IS NOT NULL AND consumedAt < ?
  `).run(consumedBefore).changes;

  const expiredDeleted = db.prepare(`
    DELETE FROM MfaChallenge
    WHERE consumedAt IS NULL AND expiresAt < ?
  `).run(expiredBefore).changes;

  return { consumedDeleted, expiredDeleted };
}

export function runMfaChallengeCleanupOnce(): MfaCleanupSummary {
  const db = new Database(getDatabasePath());
  try {
    return cleanupMfaChallenges(db);
  } finally {
    db.close();
  }
}
