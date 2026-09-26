// @vitest-environment node

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { cleanupMfaChallenges } from '@/lib/security/mfa-cleanup';

function createChallengeSchema(db: Database.Database): void {
  db.exec(`
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
  `);
}

describe('MFA challenge cleanup', () => {
  it('removes only stale consumed and expired rows', () => {
    const db = new Database(':memory:');
    createChallengeSchema(db);
    const now = new Date('2026-08-07T12:00:00.000Z');
    const insert = db.prepare(`
      INSERT INTO MfaChallenge (id, userId, challengeHash, purpose, provider, expiresAt, attemptCount, consumedAt, createdAt)
      VALUES (?, ?, ?, 'login', 'credentials', ?, 0, ?, ?)
    `);
    // consumed 25h ago -> delete
    insert.run('old-consumed', 'u1', 'h1', new Date(now.getTime() - 90 * 60 * 60 * 1000).toISOString(), new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(), new Date(now.getTime() - 26 * 60 * 60 * 1000).toISOString());
    // unconsumed, expired 2h ago -> delete
    insert.run('old-expired', 'u1', 'h2', new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(), null, new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString());
    // consumed 1h ago -> keep
    insert.run('recent-consumed', 'u1', 'h3', new Date(now.getTime() - 30 * 60 * 1000).toISOString(), new Date(now.getTime() - 60 * 60 * 1000).toISOString(), new Date(now.getTime() - 90 * 60 * 1000).toISOString());
    // unconsumed, still valid -> keep
    insert.run('valid', 'u1', 'h4', new Date(now.getTime() + 60 * 1000).toISOString(), null, new Date(now.getTime() - 60 * 1000).toISOString());

    const summary = cleanupMfaChallenges(db, now);
    expect(summary).toEqual({ consumedDeleted: 1, expiredDeleted: 1 });
    const remaining = db.prepare('SELECT id FROM MfaChallenge ORDER BY id').all() as Array<{ id: string }>;
    expect(remaining.map((row) => row.id)).toEqual(['recent-consumed', 'valid']);
    db.close();
  });
});
