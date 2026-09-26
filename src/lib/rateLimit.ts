/**
 * The async limiter uses Redis REST when configured and the transient database table otherwise.
 * The synchronous SQLite implementation remains for local compatibility and focused tests.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { getEphemeralStore } from '@/lib/ephemeral-store';

const DB_PATH = process.env.DATABASE_PATH
  ?? path.join(process.cwd(), 'prisma', 'dev.db');

const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 3;

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('busy_timeout = 5000');

    _db.exec(`
      CREATE TABLE IF NOT EXISTS _rate_limits (
        ip TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ip, window_start)
      );
    `);
  }
  return _db;
}

export function rateLimit(ip: string): { allowed: boolean; remaining: number; resetIn: number } {
  const db = getDb();
  const now = Date.now();
  const windowStart = now - (now % WINDOW_MS);
  const nextWindowStart = windowStart + WINDOW_MS;

  const row = db.prepare(
    'SELECT request_count FROM _rate_limits WHERE ip = ? AND window_start = ?'
  ).get(ip, windowStart) as { request_count: number } | undefined;

  if (!row) {
    db.prepare(
      'INSERT OR REPLACE INTO _rate_limits (ip, window_start, request_count) VALUES (?, ?, 1)'
    ).run(ip, windowStart);
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetIn: WINDOW_MS };
  }

  if (row.request_count >= MAX_REQUESTS) {
    const resetIn = nextWindowStart - now;
    return { allowed: false, remaining: 0, resetIn };
  }

  db.prepare(
    'UPDATE _rate_limits SET request_count = request_count + 1 WHERE ip = ? AND window_start = ?'
  ).run(ip, windowStart);

  const remaining = MAX_REQUESTS - row.request_count - 1;
  return { allowed: true, remaining, resetIn: nextWindowStart - now };
}

export async function rateLimitAsync(identifier: string): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const now = Date.now();
  const windowStart = now - (now % WINDOW_MS);
  const resetIn = windowStart + WINDOW_MS - now;
  const count = await getEphemeralStore().increment(`rate-limit:${identifier}:${windowStart}`, resetIn);
  return {
    allowed: count <= MAX_REQUESTS,
    remaining: Math.max(MAX_REQUESTS - count, 0),
    resetIn,
  };
}

export function cleanupRateLimitStore(): void {
  if (_db) {
    try {
      const cutoff = Date.now() - WINDOW_MS * 2;
      _db.prepare('DELETE FROM _rate_limits WHERE window_start < ?').run(cutoff);
      _db.exec('DELETE FROM _rate_limits'); // test isolation: clear all
    } catch {}
    _db.close();
    _db = null;
  }
}
