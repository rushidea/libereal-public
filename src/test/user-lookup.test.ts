import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { findUserByEmailCaseInsensitive } from '@/lib/user-lookup';
import { getTestDb, closeTestDb, clearAllTables, seedUserWithPassword } from './db-helpers';

describe('findUserByEmailCaseInsensitive', () => {
  beforeAll(() => {
    getTestDb();
  });

  afterAll(() => {
    closeTestDb();
  });

  beforeEach(() => {
    clearAllTables(getTestDb());
  });

  it('finds users regardless of stored email casing', async () => {
    seedUserWithPassword(getTestDb(), {
      id: 'usr_case',
      email: 'User@Example.com',
      passwordHash: await bcrypt.hash('secret1234', 12),
    });

    const user = await findUserByEmailCaseInsensitive('user@example.com');
    expect(user?.id).toBe('usr_case');
    expect(user?.email).toBe('User@Example.com');
  });
});
