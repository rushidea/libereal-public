import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireAdminStepUp: vi.fn(),
  isAdminMfaScenarioEnabled: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  requireAdmin: mocks.requireAdmin,
  requireAdminStepUp: mocks.requireAdminStepUp,
}));
vi.mock('@/lib/admin-mfa-settings', () => ({
  isAdminMfaScenarioEnabled: mocks.isAdminMfaScenarioEnabled,
}));

import { PATCH } from '@/app/api/admin/users/[id]/credit/route';
import { NextRequest } from 'next/server';

const admin = { id: 'admin_test_id', email: 'admin@test.com', role: 'admin', sessionId: 'session-1' };

describe('credit adjustment MFA scenario switch', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'user_1', email: 'buyer@test.com', tier: 'standard' });
    mocks.requireAdmin.mockReset();
    mocks.requireAdminStepUp.mockReset();
    mocks.isAdminMfaScenarioEnabled.mockReset();
  });

  function patchRequest(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/admin/users/user_1/credit', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rejects the adjustment before touching data when the scenario requires step-up', async () => {
    mocks.requireAdmin.mockResolvedValue(admin);
    mocks.isAdminMfaScenarioEnabled.mockResolvedValue(true);
    mocks.requireAdminStepUp.mockResolvedValue(NextResponse.json({ error: 'Admin MFA required' }, { status: 403 }));

    const response = await PATCH(patchRequest({ overrideLimit: 8000 }), { params: Promise.resolve({ id: 'user_1' }) });

    expect(response.status).toBe(403);
    expect(mocks.requireAdmin).toHaveBeenCalledWith('customers.write');
    expect(mocks.requireAdminStepUp).toHaveBeenCalledWith(admin);
    expect(getTestDb().prepare('SELECT overrideLimit FROM CreditAccount WHERE userId = ?').get('user_1')).toBeUndefined();
  });

  it('skips step-up and applies the adjustment when the scenario is disabled', async () => {
    mocks.requireAdmin.mockResolvedValue(admin);
    mocks.isAdminMfaScenarioEnabled.mockResolvedValue(false);

    const response = await PATCH(patchRequest({ overrideLimit: 8000, reason: '测试' }), { params: Promise.resolve({ id: 'user_1' }) });

    expect(response.status).toBe(200);
    expect(mocks.requireAdminStepUp).not.toHaveBeenCalled();
    const json = await response.json();
    expect(json.account.overrideLimit).toBe(8000);
    const db = getTestDb();
    expect(db.prepare('SELECT overrideLimit FROM CreditAccount WHERE userId = ?').get('user_1')).toEqual({ overrideLimit: 8000 });
    expect(db.prepare('SELECT type, reason FROM CreditTransaction WHERE userId = ?').all('user_1')).toContainEqual({ type: 'admin_adjust', reason: '测试' });
    expect(db.prepare('SELECT action FROM AuditLog WHERE action = ?').get('customer.credit_changed')).toEqual({ action: 'customer.credit_changed' });
  });

  it('applies the adjustment after a successful step-up when the scenario is enabled', async () => {
    mocks.requireAdmin.mockResolvedValue(admin);
    mocks.isAdminMfaScenarioEnabled.mockResolvedValue(true);
    mocks.requireAdminStepUp.mockResolvedValue(admin);

    const response = await PATCH(patchRequest({ paymentTermDays: 45, reason: '测试' }), { params: Promise.resolve({ id: 'user_1' }) });

    expect(response.status).toBe(200);
    expect(mocks.requireAdminStepUp).toHaveBeenCalledWith(admin);
    const json = await response.json();
    expect(json.account.paymentTermDays).toBe(45);
  });
});
