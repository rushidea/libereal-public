import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve('prisma/migrations/20260911120000_add_active_alipay_attempt_uniqueness/migration.sql'), 'utf8');
function database() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE PaymentAttempt (id TEXT PRIMARY KEY, orderId TEXT, provider TEXT, status TEXT)');
  return db;
}
describe('schema-only active payment invariant', () => {
  it('prevents active duplicates and permits terminal and other-provider rows', () => {
    const db = database();
    try {
      db.exec(sql);
      const insert = db.prepare('INSERT INTO PaymentAttempt VALUES (?, ?, ?, ?)');
      insert.run('first', 'synthetic-order', 'alipay', 'created');
      expect(() => insert.run('second', 'synthetic-order', 'alipay', 'WAIT_BUYER_PAY')).toThrow();
      insert.run('terminal', 'synthetic-order', 'alipay', 'TRADE_CLOSED');
      insert.run('other', 'synthetic-order', 'synthetic-provider', 'created');
      db.prepare('UPDATE PaymentAttempt SET status = ? WHERE id = ?').run('TRADE_SUCCESS', 'first');
      insert.run('replacement', 'synthetic-order', 'alipay', 'redirected');
      expect(db.prepare('SELECT COUNT(*) AS n FROM PaymentAttempt').get()).toEqual({ n: 4 });
    } finally { db.close(); }
  });
  it('aborts migration on historical duplicates without changing financial rows', () => {
    const db = database();
    try {
      db.exec("INSERT INTO PaymentAttempt VALUES ('a','synthetic-order','alipay','created'),('b','synthetic-order','alipay','redirected')");
      const before = db.prepare('SELECT * FROM PaymentAttempt ORDER BY id').all();
      expect(() => db.exec(sql)).toThrow();
      expect(db.prepare('SELECT * FROM PaymentAttempt ORDER BY id').all()).toEqual(before);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'PaymentAttempt_active_alipay_order_key'").get()).toBeUndefined();
    } finally { db.close(); }
  });
});
