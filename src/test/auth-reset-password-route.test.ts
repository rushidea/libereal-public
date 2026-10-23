import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { getTestDb, closeTestDb, clearAllTables } from './db-helpers';
import { POST as resetPasswordPOST } from '@/app/api/auth/reset-password/route';
import { PASSWORD_TOO_SHORT_MESSAGE } from '@/lib/password-policy';

function makePost(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/reset-password', () => {
  beforeAll(() => {
    getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  beforeEach(async () => {
    const db = getTestDb();
    clearAllTables(db);
    const hash = await bcrypt.hash('oldpass123', 12);
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO User (id, name, email, role, password, resetToken, resetTokenExpiry, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run('u1', 'User', 'user@test.com', 'customer', hash, 'valid-token', expiry);
  });

  it('returns 400 when password is not a string', async () => {
    const res = await resetPasswordPOST(makePost({ token: 'valid-token', password: 12345678 }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/缺少必填参数/);
  });

  it('rejects passwords shorter than minimum length', async () => {
    const res = await resetPasswordPOST(makePost({ token: 'valid-token', password: 'abc123' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(PASSWORD_TOO_SHORT_MESSAGE);
  });

  it('resets password when token is valid and password meets minimum length', async () => {
    const res = await resetPasswordPOST(makePost({ token: 'valid-token', password: 'newpass123' }));
    expect(res.status).toBe(200);

    const db = getTestDb();
    const row = db.prepare('SELECT password, resetToken FROM User WHERE id = ?').get('u1') as {
      password: string;
      resetToken: string | null;
    };
    expect(row.resetToken).toBeNull();
    expect(await bcrypt.compare('newpass123', row.password)).toBe(true);
  });

  it('revokes every existing session for the user when the password changes', async () => {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO User (id, name, email, role, password, createdAt, updatedAt)
      VALUES ('u2', 'Other', 'other@test.com', 'customer', 'hash', datetime('now'), datetime('now'))
    `).run();
    const insertSession = db.prepare(`
      INSERT INTO user_sessions (id, user_id, session_id, created_at, last_seen_at, revoked_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'), NULL)
    `);
    insertSession.run('s-current', 'u1', 'session-current');
    insertSession.run('s-other', 'u1', 'session-other');
    insertSession.run('s-stranger', 'u2', 'session-stranger');

    const res = await resetPasswordPOST(makePost({ token: 'valid-token', password: 'newpass123' }));
    expect(res.status).toBe(200);

    const sessions = db.prepare(`
      SELECT id, user_id, revoked_at FROM user_sessions ORDER BY id
    `).all() as Array<{ id: string; user_id: string; revoked_at: string | null }>;
    const byId = Object.fromEntries(sessions.map((row) => [row.id, row]));
    expect(byId['s-current'].revoked_at).toBeTruthy();
    expect(byId['s-other'].revoked_at).toBeTruthy();
    expect(byId['s-stranger'].revoked_at).toBeNull();

    const user = db.prepare('SELECT password, resetToken FROM User WHERE id = ?').get('u1') as {
      password: string;
      resetToken: string | null;
    };
    expect(user.resetToken).toBeNull();
    expect(await bcrypt.compare('newpass123', user.password)).toBe(true);
  });

  it('does not change the password when session revoke fails', async () => {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO user_sessions (id, user_id, session_id, created_at, last_seen_at, revoked_at)
      VALUES ('s-keep', 'u1', 'session-keep', datetime('now'), datetime('now'), NULL)
    `).run();
    const before = db.prepare('SELECT password, resetToken FROM User WHERE id = ?').get('u1') as {
      password: string;
      resetToken: string | null;
    };
    // Abort the revoke UPDATE after the password write has already run in the
    // same transaction. SQLite surfaces RAISE(ABORT) as a constraint error.
    db.exec(`
      CREATE TRIGGER user_sessions_revoke_fail
      BEFORE UPDATE OF revoked_at ON user_sessions
      FOR EACH ROW
      WHEN NEW.revoked_at IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'revoke failed');
      END;
    `);

    try {
      const res = await resetPasswordPOST(makePost({ token: 'valid-token', password: 'newpass123' }));
      expect(res.status).toBe(500);

      const after = db.prepare('SELECT password, resetToken, resetTokenExpiry FROM User WHERE id = ?').get('u1') as {
        password: string;
        resetToken: string | null;
        resetTokenExpiry: string | null;
      };
      expect(after.password).toBe(before.password);
      expect(await bcrypt.compare('oldpass123', after.password)).toBe(true);
      expect(await bcrypt.compare('newpass123', after.password)).toBe(false);
      expect(after.resetToken).toBe('valid-token');
      expect(after.resetTokenExpiry).toBeTruthy();
      const session = db.prepare('SELECT revoked_at FROM user_sessions WHERE id = ?').get('s-keep') as {
        revoked_at: string | null;
      };
      expect(session.revoked_at).toBeNull();
    } finally {
      db.exec('DROP TRIGGER IF EXISTS user_sessions_revoke_fail');
    }
  });
});
