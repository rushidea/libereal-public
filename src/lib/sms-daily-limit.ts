import Database from 'better-sqlite3';
import path from 'path';
import { getEphemeralStore } from '@/lib/ephemeral-store';

const DB_PATH = process.env.DATABASE_PATH
  ?? path.join(process.cwd(), 'prisma', 'dev.db');

const MAX_DAILY_SECURITY_SMS = 3;

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    _db.pragma('busy_timeout = 5000');
    _db.exec(`
      CREATE TABLE IF NOT EXISTS _sms_daily_limits (
        identifier TEXT NOT NULL,
        day_key TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (identifier, day_key)
      );
    `);
  }
  return _db;
}

function getDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function msUntilNextUtcDay(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

export function smsDailyLimit(identifier: string): { allowed: boolean; remaining: number; resetIn: number } {
  const db = getDb();
  const dayKey = getDayKey();
  const row = db.prepare(
    'SELECT request_count FROM _sms_daily_limits WHERE identifier = ? AND day_key = ?'
  ).get(identifier, dayKey) as { request_count: number } | undefined;

  if (!row) {
    db.prepare(
      'INSERT OR REPLACE INTO _sms_daily_limits (identifier, day_key, request_count) VALUES (?, ?, 1)'
    ).run(identifier, dayKey);
    return { allowed: true, remaining: MAX_DAILY_SECURITY_SMS - 1, resetIn: msUntilNextUtcDay() };
  }

  if (row.request_count >= MAX_DAILY_SECURITY_SMS) {
    return { allowed: false, remaining: 0, resetIn: msUntilNextUtcDay() };
  }

  db.prepare(
    'UPDATE _sms_daily_limits SET request_count = request_count + 1 WHERE identifier = ? AND day_key = ?'
  ).run(identifier, dayKey);

  return {
    allowed: true,
    remaining: MAX_DAILY_SECURITY_SMS - row.request_count - 1,
    resetIn: msUntilNextUtcDay(),
  };
}

export async function smsDailyLimitAsync(identifier: string): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const resetIn = msUntilNextUtcDay();
  const count = await getEphemeralStore().increment(`sms-daily:${identifier}:${getDayKey()}`, resetIn);
  return { allowed: count <= MAX_DAILY_SECURITY_SMS, remaining: Math.max(MAX_DAILY_SECURITY_SMS - count, 0), resetIn };
}
