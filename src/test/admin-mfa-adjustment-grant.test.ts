import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';
import {
  consumeAdminMfaAdjustmentGrant,
  issueAdminMfaAdjustmentGrant,
} from '@/lib/security/admin-mfa-adjustment-grant';

describe('admin MFA adjustment grant', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => { clearAllTables(getTestDb()); });

  it('consumes a grant exactly once for the matching user and session', async () => {
    const token = await issueAdminMfaAdjustmentGrant({ userId: 'admin-1', sessionId: 'session-1' });

    expect(token.length).toBeGreaterThan(32);
    await expect(consumeAdminMfaAdjustmentGrant(token, { userId: 'admin-1', sessionId: 'session-1' })).resolves.toBe(true);
    await expect(consumeAdminMfaAdjustmentGrant(token, { userId: 'admin-1', sessionId: 'session-1' })).resolves.toBe(false);
  });

  it('keeps a grant intact when presented with a different user or session', async () => {
    const token = await issueAdminMfaAdjustmentGrant({ userId: 'admin-1', sessionId: 'session-1' });

    await expect(consumeAdminMfaAdjustmentGrant(token, { userId: 'admin-2', sessionId: 'session-1' })).resolves.toBe(false);
    await expect(consumeAdminMfaAdjustmentGrant(token, { userId: 'admin-1', sessionId: 'session-2' })).resolves.toBe(false);
    await expect(consumeAdminMfaAdjustmentGrant(token, { userId: 'admin-1', sessionId: 'session-1' })).resolves.toBe(true);
  });

  it('rejects empty and oversized tokens without touching the store', async () => {
    await expect(consumeAdminMfaAdjustmentGrant('', { userId: 'admin-1', sessionId: 'session-1' })).resolves.toBe(false);
    await expect(consumeAdminMfaAdjustmentGrant('x'.repeat(257), { userId: 'admin-1', sessionId: 'session-1' })).resolves.toBe(false);
  });

  it('rejects an expired grant', async () => {
    const token = await issueAdminMfaAdjustmentGrant({ userId: 'admin-1', sessionId: 'session-1' });
    getTestDb().prepare('UPDATE TransientEntry SET expiresAt = ? WHERE key LIKE ?')
      .run(new Date(Date.now() - 1000).toISOString(), 'admin-mfa-adjustment:%');

    await expect(consumeAdminMfaAdjustmentGrant(token, { userId: 'admin-1', sessionId: 'session-1' })).resolves.toBe(false);
  });
});
