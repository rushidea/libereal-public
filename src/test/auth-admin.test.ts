import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { normalizeEmail, resolveSessionRole, isBcryptHash, userHasPassword, isGoogleLoginEnabled } from '@/lib/auth-helpers';
import { getTestDb, closeTestDb, seedUser, clearAllTables } from './db-helpers';

describe('auth admin helpers', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('normalizeEmail trims and lowercases', () => {
    expect(normalizeEmail('  IcyLix@Gmail.COM  ')).toBe('icylix@gmail.com');
  });

  it('resolveSessionRole promotes ADMIN_EMAILS to admin', () => {
    expect(resolveSessionRole('customer', 'icylix@gmail.com')).toBe('admin');
    expect(resolveSessionRole('admin', 'icylix@gmail.com')).toBe('admin');
    expect(resolveSessionRole('customer', 'other@test.com')).toBe('customer');
    expect(resolveSessionRole(null, 'other@test.com')).toBe('customer');
  });

  it('userHasPassword returns false for empty or non-bcrypt password', () => {
    expect(userHasPassword('')).toBe(false);
    expect(userHasPassword(null)).toBe(false);
    expect(userHasPassword('plaintext')).toBe(false);
    expect(isBcryptHash('$2a$12$abcdefghijklmnopqrstuv')).toBe(true);
  });

  it('shows the Google entry unless it is explicitly disabled', () => {
    expect(isGoogleLoginEnabled()).toBe(true);
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED', 'false');
    expect(isGoogleLoginEnabled()).toBe(false);
  });
});

describe('credentials email lookup', () => {
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
  });
  afterAll(() => { closeTestDb(); });

  it('finds user with case-insensitive email', () => {
    const db = getTestDb();
    seedUser(db, { id: 'admin1', email: 'icylix@gmail.com', role: 'admin' });

    const normalized = normalizeEmail('IcyLix@Gmail.COM');
    const user = db.prepare(
      'SELECT id, email, role FROM User WHERE lower(email) = ?'
    ).get(normalized) as { id: string; email: string; role: string } | undefined;

    expect(user?.id).toBe('admin1');
    expect(user?.role).toBe('admin');
  });

  it('promotes admin email role in DB', () => {
    const db = getTestDb();
    seedUser(db, { id: 'admin1', email: 'icylix@gmail.com', role: 'customer' });

    db.prepare(
      `UPDATE User SET role = 'admin', updatedAt = ? WHERE id = ? AND COALESCE(role, '') != 'admin'`
    ).run(new Date().toISOString(), 'admin1');

    const user = db.prepare('SELECT role FROM User WHERE id = ?').get('admin1') as { role: string };
    expect(user.role).toBe('admin');
  });
});
