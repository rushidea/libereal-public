import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';
import { DEFAULT_ADMIN_MFA_SCENARIOS, scenarioConfigToJson } from '@/lib/admin-mfa-scenarios';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));

import { requireAdmin } from '@/lib/session';

describe('dynamic admin MFA scenario enforcement', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
  });

  it('keeps routine customer review free of MFA by default', async () => {
    const previous = process.env.MFA_ADMIN_REQUIRED;
    process.env.MFA_ADMIN_REQUIRED = 'true';
    try {
      await expect(requireAdmin('customers.write')).resolves.toEqual(
        expect.objectContaining({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin' }),
      );
    } finally {
      if (previous === undefined) delete process.env.MFA_ADMIN_REQUIRED;
      else process.env.MFA_ADMIN_REQUIRED = previous;
    }
  });

  it('enforces MFA for customer review once the scenario is enabled in storage', async () => {
    const previous = process.env.MFA_ADMIN_REQUIRED;
    process.env.MFA_ADMIN_REQUIRED = 'true';
    try {
      getTestDb().prepare(`
        INSERT INTO AdminMfaSetting (id, scenarios, updatedAt)
        VALUES ('default', ?, datetime('now'))
      `).run(scenarioConfigToJson({ ...DEFAULT_ADMIN_MFA_SCENARIOS, 'customers.write': true }));

      const response = await requireAdmin('customers.write');
      expect(response).toHaveProperty('status', 403);
      await expect((response as Response).json()).resolves.toEqual({ error: 'Admin MFA required', redirect: '/account/security' });
    } finally {
      if (previous === undefined) delete process.env.MFA_ADMIN_REQUIRED;
      else process.env.MFA_ADMIN_REQUIRED = previous;
    }
  });

  it('removes the MFA gate again after the scenario is disabled', async () => {
    const previous = process.env.MFA_ADMIN_REQUIRED;
    process.env.MFA_ADMIN_REQUIRED = 'true';
    try {
      getTestDb().prepare(`
        INSERT INTO AdminMfaSetting (id, scenarios, updatedAt)
        VALUES ('default', ?, datetime('now'))
      `).run(scenarioConfigToJson({ ...DEFAULT_ADMIN_MFA_SCENARIOS, 'customers.write': false }));

      await expect(requireAdmin('customers.write')).resolves.toEqual(
        expect.objectContaining({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin' }),
      );
    } finally {
      if (previous === undefined) delete process.env.MFA_ADMIN_REQUIRED;
      else process.env.MFA_ADMIN_REQUIRED = previous;
    }
  });
});
