/** Install SQL-only invariants after Prisma db push on the synthetic CI database. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';

const expected = resolve('prisma/ci.db');
const actual = resolve(process.env.DATABASE_PATH ?? '');
if (actual !== expected || process.env.AUTH_SECRET !== 'ci-dummy-auth-secret-for-github-actions') {
  throw new Error('CI invariant preparation requires the explicit synthetic prisma/ci.db configuration');
}
const db = new Database(actual, { fileMustExist: true });
try {
  const sql = readFileSync(resolve('prisma/migrations/20260911120000_add_active_alipay_attempt_uniqueness/migration.sql'), 'utf8');
  db.exec(sql);
} finally {
  db.close();
}
