// @vitest-environment node

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const initialSql = fs.readFileSync(
  path.join(process.cwd(), 'prisma/migrations/20260807150000_add_security_center_sessions/migration.sql'),
  'utf8',
);
const fixSql = fs.readFileSync(
  path.join(process.cwd(), 'prisma/migrations/20260807160000_fix_security_device_history/migration.sql'),
  'utf8',
);

describe('security session migration', () => {
  it('keeps revoked device history while allowing a new active device record', () => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY);');
      db.exec(initialSql);
      db.exec(fixSql);
      db.prepare('INSERT INTO "User" ("id") VALUES (?)').run('user-1');
      db.prepare(`
        INSERT INTO "user_devices" ("id", "user_id", "fingerprint", "last_seen_at", "revoked_at")
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run('device-old', 'user-1', 'fingerprint-1');
      expect(() => db.prepare(`
        INSERT INTO "user_devices" ("id", "user_id", "fingerprint", "last_seen_at")
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `).run('device-new', 'user-1', 'fingerprint-1')).not.toThrow();

      const indexes = db.prepare(`
        SELECT sql FROM sqlite_master
        WHERE type = 'index' AND name = 'user_devices_user_id_fingerprint_active_key'
      `).get() as { sql: string };
      expect(indexes.sql).toContain('WHERE "revoked_at" IS NULL');
    } finally {
      db.close();
    }
  });
});
