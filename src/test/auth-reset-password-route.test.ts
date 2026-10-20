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
});
