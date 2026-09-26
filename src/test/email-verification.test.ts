import { createHash } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { consumeRegistrationEmailCode } from '@/lib/email-verification';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

function tokenFor(email: string, code: string): string {
  return createHash('sha256')
    .update(`registration-email:${email}:${code}`)
    .digest('hex');
}

describe('registration email verification', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => { clearAllTables(getTestDb()); });

  it('accepts a current code once and consumes it', async () => {
    const email = 'researcher@example.com';
    const code = '123456';
    const token = tokenFor(email, code);
    getTestDb().prepare(
      'INSERT INTO VerificationToken (identifier, token, expires) VALUES (?, ?, ?)',
    ).run(`registration-email:${email}`, token, new Date(Date.now() + 60_000).toISOString());

    await expect(consumeRegistrationEmailCode(email, code)).resolves.toBe(true);
    await expect(consumeRegistrationEmailCode(email, code)).resolves.toBe(false);
  });

  it('rejects an expired code', async () => {
    const email = 'researcher@example.com';
    const code = '123456';
    getTestDb().prepare(
      'INSERT INTO VerificationToken (identifier, token, expires) VALUES (?, ?, ?)',
    ).run(`registration-email:${email}`, tokenFor(email, code), new Date(Date.now() - 60_000).toISOString());

    await expect(consumeRegistrationEmailCode(email, code)).resolves.toBe(false);
  });
});
