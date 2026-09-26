import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

const { requireAdmin } = vi.hoisted(() => ({
  requireAdmin: vi.fn(async (): Promise<{ id: string; email: string; role: string; sessionId?: string }> => ({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin' })),
}));
const { getAdminMfaPolicy } = vi.hoisted(() => ({
  getAdminMfaPolicy: vi.fn(async () => ({
    required: false,
    requirement: 'admin',
    hasTotp: false,
    hasPasskey: false,
    satisfied: true,
  })),
}));
const mfaSettings = vi.hoisted(() => ({
  getAdminMfaSettings: vi.fn(async () => ({
    enabled: false,
    available: true,
    scenariosEnforced: false,
    protection: {
      badge: '双因素认证功能已开放',
      tone: 'off' as const,
      hint: '验证器功能已经开放；管理员敏感操作保护仍由管理员强制开关控制。当前可保存下方场景配置，启用强制保护后生效。',
    },
    scenarios: { 'roles.manage': true },
    groups: [],
    updatedAt: null,
    updatedByEmail: null,
    policySummary: {
      adminLogin: '管理员登录无需再次验证；敏感操作前需要确认身份',
      userLogin: '用户可自行开启；开启后登录需要验证',
      sensitiveOperations: '管理员强制保护开启后，按照下方设置在指定操作前再次确认身份。',
      ordinaryOperations: '普通组织与账户操作无需再次验证',
      adjustment: '修改本页设置前需要确认身份',
    },
  })),
  saveAdminMfaScenarioConfig: vi.fn(async ({ scenarios }: { scenarios: unknown }) => scenarios),
  consumeSecurityStepUpGrant: vi.fn(async () => false),
}));
vi.mock('@/lib/session', () => ({
  requireAdmin,
  getAdminPermissions: vi.fn(async () => ['admin.access', 'roles.manage', 'audit.read']),
}));
vi.mock('@/lib/security/admin-mfa-policy', () => ({ getAdminMfaPolicy }));
vi.mock('@/lib/admin-mfa-settings', () => ({
  getAdminMfaSettings: mfaSettings.getAdminMfaSettings,
  saveAdminMfaScenarioConfig: mfaSettings.saveAdminMfaScenarioConfig,
}));
vi.mock('@/lib/security/security-step-up', () => ({
  consumeSecurityStepUpGrant: mfaSettings.consumeSecurityStepUpGrant,
}));

import { GET, POST } from '@/app/api/admin/access/route';

describe('admin role assignments', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    vi.clearAllMocks();
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'manager_1', email: 'manager@example.com' });
    db.prepare(`INSERT INTO AdminRole (id, key, name, description, updatedAt) VALUES ('role_customer_admin', 'customer_admin', '客户管理员', '客户管理', datetime('now'))`).run();
  });

  it('assigns a management role and writes an audit entry', async () => {
    const request = new NextRequest('http://localhost:3000/api/admin/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'manager_1', roleIds: ['role_customer_admin'], reason: '负责客户审核' }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
      expect(requireAdmin).toHaveBeenCalledWith('roles.manage', { token: undefined, action: 'admin_sensitive' });

    const db = getTestDb();
    expect(db.prepare('SELECT role FROM User WHERE id = ?').get('manager_1')).toEqual({ role: 'admin' });
    expect(db.prepare('SELECT roleId, assignedBy FROM AdminUserRole WHERE userId = ?').get('manager_1')).toEqual({ roleId: 'role_customer_admin', assignedBy: 'admin_test_id' });
    const audit = db.prepare('SELECT action, resource, targetId, reason FROM AuditLog WHERE targetId = ?').get('manager_1');
    expect(audit).toEqual({ action: 'roles.changed', resource: 'roles', targetId: 'manager_1', reason: '负责客户审核' });
  });

  it('creates an internal user and assigns the selected management role', async () => {
    const request = new NextRequest('http://localhost:3000/api/admin/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        view: 'create-internal-user',
        name: '内部成员',
        email: 'internal@example.com',
        password: 'internal-password',
        roleIds: ['role_customer_admin'],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(201);

    const created = getTestDb().prepare('SELECT id, email, role, approvalStatus, isNewUser FROM User WHERE email = ?').get('internal@example.com') as { id: string; email: string; role: string; approvalStatus: string; isNewUser: number };
    expect(created.role).toBe('admin');
    expect(created.approvalStatus).toBe('approved');
    expect(created.isNewUser).toBe(0);
    expect(getTestDb().prepare('SELECT roleId, assignedBy FROM AdminUserRole WHERE userId = ?').get(created.id)).toEqual({ roleId: 'role_customer_admin', assignedBy: 'admin_test_id' });
    expect(getTestDb().prepare('SELECT action, resource, targetId FROM AuditLog WHERE action = ?').get('internal_user.created')).toEqual({ action: 'internal_user.created', resource: 'roles', targetId: created.id });
  });

  it('hides the super administrator role from a regular role manager', async () => {
    requireAdmin.mockResolvedValueOnce({ id: 'manager_1', email: 'manager@example.com', role: 'admin' });

    const response = await GET(new NextRequest('http://localhost:3000/api/admin/access?view=manage'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.canManageSuperAdmin).toBe(false);
    expect(data.roles.some((role: { key: string }) => role.key === 'super_admin')).toBe(false);
  });

  it('blocks a regular role manager from creating a super administrator', async () => {
    requireAdmin.mockResolvedValueOnce({ id: 'manager_1', email: 'manager@example.com', role: 'admin' });

    const response = await POST(new NextRequest('http://localhost:3000/api/admin/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        view: 'create-internal-user',
        name: '越权成员',
        email: 'escalation@example.com',
        password: 'secure-password',
        roleIds: ['role_super_admin'],
      }),
    }));

    expect(response.status).toBe(403);
    expect(getTestDb().prepare('SELECT id FROM User WHERE email = ?').get('escalation@example.com')).toBeUndefined();
  });

  it('blocks a regular role manager from removing the super administrator role', async () => {
    requireAdmin.mockResolvedValueOnce({ id: 'manager_1', email: 'manager@example.com', role: 'admin' });

    const response = await POST(new NextRequest('http://localhost:3000/api/admin/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'admin_test_id', roleIds: [] }),
    }));

    expect(response.status).toBe(403);
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM AdminUserRole WHERE userId = ? AND roleId = ?').get('admin_test_id', 'role_super_admin')).toEqual({ count: 1 });
  });

  it('requires a valid one-time MFA grant for internal user creation', async () => {
    requireAdmin.mockResolvedValue({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin', sessionId: 'session-1' });
    mfaSettings.consumeSecurityStepUpGrant.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const create = (email: string) => POST(new NextRequest('http://localhost:3000/api/admin/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        view: 'create-internal-user',
        name: '受保护成员',
        email,
        password: 'secure-password',
        roleIds: ['role_customer_admin'],
        grantToken: 'grant-once',
      }),
    }));

    expect((await create('protected-1@example.com')).status).toBe(201);
    expect((await create('protected-2@example.com')).status).toBe(403);
    expect(getTestDb().prepare('SELECT id FROM User WHERE email = ?').get('protected-2@example.com')).toBeUndefined();
    expect(mfaSettings.consumeSecurityStepUpGrant).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized internal user input', async () => {
    const response = await POST(new NextRequest('http://localhost:3000/api/admin/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        view: 'create-internal-user',
        name: '内部成员',
        email: 'internal@example.com',
        password: 'x'.repeat(129),
        roleIds: ['role_customer_admin'],
      }),
    }));

    expect(response.status).toBe(400);
  });

  it('rejects unknown role identifiers', async () => {
    const request = new NextRequest('http://localhost:3000/api/admin/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'manager_1', roleIds: ['missing_role'] }),
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it('returns configured system administrator permissions without role assignments', async () => {
    requireAdmin.mockResolvedValueOnce({ id: 'admin_test_id', email: 'icylix@gmail.com', role: 'admin' });
    const response = await GET(new NextRequest('http://localhost:3000/api/admin/access?view=current'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      permissions: ['admin.access', 'roles.manage', 'audit.read'],
      roles: [{ id: 'role_super_admin', key: 'super_admin', name: '超级管理员' }],
      mfaPolicy: {
        required: false,
        requirement: 'admin',
        hasTotp: false,
        hasPasskey: false,
        satisfied: true,
      },
    });
  });

  it('returns individual MFA scenarios for role managers', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/admin/access?view=mfa-policy'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      enabled: false,
      available: true,
      scenariosEnforced: false,
      protection: { badge: '双因素认证功能已开放', tone: 'off' },
      scenarios: { 'roles.manage': true },
    });
  });

  it('requires a dedicated MFA adjustment grant before saving scenarios', async () => {
    const previous = process.env.MFA_PHASE1_ENABLED;
    process.env.MFA_PHASE1_ENABLED = 'true';
    try {
      requireAdmin.mockResolvedValueOnce({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin', sessionId: 'session-1' });
      const response = await POST(new NextRequest('http://localhost:3000/api/admin/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'mfa-policy', scenarios: { 'roles.manage': false }, grantToken: 'missing' }),
      }));

      expect(response.status).toBe(403);
      expect(mfaSettings.saveAdminMfaScenarioConfig).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.MFA_PHASE1_ENABLED;
      else process.env.MFA_PHASE1_ENABLED = previous;
    }
  });

  it('consumes the dedicated grant and audits saved scenarios', async () => {
    const previous = process.env.MFA_PHASE1_ENABLED;
    process.env.MFA_PHASE1_ENABLED = 'true';
    mfaSettings.consumeSecurityStepUpGrant.mockResolvedValueOnce(true);
    mfaSettings.saveAdminMfaScenarioConfig.mockResolvedValueOnce({ 'roles.manage': false });
    try {
      requireAdmin.mockResolvedValueOnce({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin', sessionId: 'session-1' });
      const response = await POST(new NextRequest('http://localhost:3000/api/admin/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'mfa-policy', scenarios: { 'roles.manage': false }, grantToken: 'grant-1' }),
      }));

      expect(response.status).toBe(200);
      expect(mfaSettings.consumeSecurityStepUpGrant).toHaveBeenCalledWith('grant-1', { userId: 'admin_test_id', sessionId: 'session-1', action: 'admin_mfa_policy' });
      expect(mfaSettings.saveAdminMfaScenarioConfig).toHaveBeenCalledWith({ scenarios: { 'roles.manage': false }, updatedByEmail: 'admin@test.com' });
      expect(getTestDb().prepare('SELECT action, resource FROM AuditLog WHERE action = ?').get('admin.mfa_policy_changed')).toEqual({ action: 'admin.mfa_policy_changed', resource: 'security' });
    } finally {
      if (previous === undefined) delete process.env.MFA_PHASE1_ENABLED;
      else process.env.MFA_PHASE1_ENABLED = previous;
    }
  });
});
