import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getSecuritySessionState: vi.fn(),
  getSecuritySessionStateDetailed: vi.fn(),
  getSecurityRequestMetadata: vi.fn(),
  registerSecuritySession: vi.fn(),
  touchSecuritySession: vi.fn(),
  hasRecentSecuritySessionMfa: vi.fn(),
  getAdminMfaPolicy: vi.fn(),
  shouldRequireAdminMfaForPermission: vi.fn((permission: string) => ['orders.write', 'roles.manage'].includes(permission)),
}));

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/security/security-session-service', () => ({
  getSecuritySessionState: mocks.getSecuritySessionState,
  getSecuritySessionStateDetailed: mocks.getSecuritySessionStateDetailed,
  getSecurityRequestMetadata: mocks.getSecurityRequestMetadata,
  registerSecuritySession: mocks.registerSecuritySession,
  touchSecuritySession: mocks.touchSecuritySession,
  hasRecentSecuritySessionMfa: mocks.hasRecentSecuritySessionMfa,
}));
vi.mock('@/lib/security/admin-mfa-policy', () => ({
  getAdminMfaPolicy: mocks.getAdminMfaPolicy,
}));
vi.mock('@/lib/admin-mfa-settings', () => ({
  requiresAdminMfaForPermission: mocks.shouldRequireAdminMfaForPermission,
}));

import { requireActiveSession, requireAdmin, requireAdminStepUp, requireRecentMfaUser } from '@/lib/session';

const sessionUser = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'customer',
  sessionId: 'session-1',
};

describe('requireActiveSession', () => {
  it('rejects JWTs without a session id so revoked sessions cannot be bypassed', async () => {
    mocks.auth.mockResolvedValue({ user: { ...sessionUser, sessionId: null } });

    const response = await requireActiveSession();

    expect(response).toHaveProperty('status', 401);
    await expect((response as Response).json()).resolves.toEqual({ error: '会话已更新，请重新登录' });
    expect(mocks.getSecuritySessionState).not.toHaveBeenCalled();
  });

  it('registers legacy sessions on first access', async () => {
    mocks.auth.mockResolvedValue({ user: sessionUser });
    mocks.getSecuritySessionState.mockResolvedValue({ known: false, active: false });
    mocks.getSecurityRequestMetadata.mockResolvedValue({ ip: null, userAgent: null, browser: null, operatingSystem: null, fingerprint: 'fingerprint' });

    await expect(requireActiveSession()).resolves.toEqual(sessionUser);
    expect(mocks.registerSecuritySession).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 'session-1',
      metadata: expect.objectContaining({ fingerprint: 'fingerprint' }),
    });
  });

  it('returns distinct responses for revoked and expired sessions', async () => {
    mocks.auth.mockResolvedValue({ user: sessionUser });
    mocks.getSecuritySessionState.mockResolvedValue({ known: true, active: false });

    mocks.getSecuritySessionStateDetailed.mockResolvedValue('revoked');
    const revoked = await requireActiveSession();
    expect(revoked).toHaveProperty('status', 401);
    await expect((revoked as Response).json()).resolves.toEqual({ error: 'Session revoked' });

    mocks.getSecuritySessionStateDetailed.mockResolvedValue('expired');
    const expired = await requireActiveSession();
    expect(expired).toHaveProperty('status', 401);
    await expect((expired as Response).json()).resolves.toEqual({ error: 'Session expired' });
  });

  it('touches active sessions', async () => {
    mocks.auth.mockResolvedValue({ user: sessionUser });
    mocks.getSecuritySessionState.mockResolvedValue({ known: true, active: true });

    await expect(requireActiveSession()).resolves.toEqual(sessionUser);
    expect(mocks.touchSecuritySession).toHaveBeenCalledWith('user-1', 'session-1');
  });

  it('accepts a recent TOTP step-up recorded on the active session', async () => {
    const user = { ...sessionUser, authLevel: 'primary_verified' as const };
    mocks.auth.mockResolvedValue({ user });
    mocks.getSecuritySessionState.mockResolvedValue({ known: true, active: true });
    mocks.hasRecentSecuritySessionMfa.mockResolvedValue(true);

    await expect(requireRecentMfaUser()).resolves.toEqual(user);
    expect(mocks.hasRecentSecuritySessionMfa).toHaveBeenCalledWith('user-1', 'session-1');
  });

  it('does not require MFA for routine customer administration when the policy is enabled', async () => {
    const previous = process.env.MFA_ADMIN_REQUIRED;
    process.env.MFA_ADMIN_REQUIRED = 'true';
    try {
      const user = { ...sessionUser, email: 'icylix@gmail.com', role: 'admin', authLevel: 'primary_verified' as const };
      mocks.auth.mockResolvedValue({ user });
      mocks.getSecuritySessionState.mockResolvedValue({ known: true, active: true });

      const response = await requireAdmin('customers.write');
      expect(response).toEqual(user);
      expect(mocks.getAdminMfaPolicy).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.MFA_ADMIN_REQUIRED;
      else process.env.MFA_ADMIN_REQUIRED = previous;
    }
  });

  it('continues to protect sensitive order permissions when the policy is enabled', async () => {
    const previous = process.env.MFA_ADMIN_REQUIRED;
    process.env.MFA_ADMIN_REQUIRED = 'true';
    try {
      mocks.auth.mockResolvedValue({ user: { ...sessionUser, email: 'icylix@gmail.com', role: 'admin', authLevel: 'primary_verified' } });
      mocks.getSecuritySessionState.mockResolvedValue({ known: true, active: true });
      mocks.hasRecentSecuritySessionMfa.mockResolvedValue(false);

      const response = await requireAdmin('orders.write');
      expect(response).toHaveProperty('status', 403);
      await expect((response as Response).json()).resolves.toEqual({ error: 'Admin MFA required', redirect: '/account/security' });
    } finally {
      if (previous === undefined) delete process.env.MFA_ADMIN_REQUIRED;
      else process.env.MFA_ADMIN_REQUIRED = previous;
    }
  });

  it('accepts a recent step-up recorded on the active session for sensitive permissions', async () => {
    const previous = process.env.MFA_ADMIN_REQUIRED;
    process.env.MFA_ADMIN_REQUIRED = 'true';
    try {
      const user = {
        ...sessionUser,
        email: 'icylix@gmail.com',
        role: 'admin' as const,
        authLevel: 'primary_verified' as const,
      };
      mocks.auth.mockResolvedValue({ user });
      mocks.getSecuritySessionState.mockResolvedValue({ known: true, active: true });
      mocks.hasRecentSecuritySessionMfa.mockResolvedValue(true);
      mocks.getAdminMfaPolicy.mockResolvedValue({
        required: true,
        requirement: 'admin',
        hasTotp: true,
        hasPasskey: false,
        satisfied: true,
      });

      await expect(requireAdmin('orders.write')).resolves.toEqual(user);
      expect(mocks.hasRecentSecuritySessionMfa).toHaveBeenCalledWith('user-1', 'session-1');
    } finally {
      if (previous === undefined) delete process.env.MFA_ADMIN_REQUIRED;
      else process.env.MFA_ADMIN_REQUIRED = previous;
    }
  });

  it('continues to protect permission management when the policy is enabled', async () => {
    const previous = process.env.MFA_ADMIN_REQUIRED;
    process.env.MFA_ADMIN_REQUIRED = 'true';
    try {
      mocks.auth.mockResolvedValue({ user: { ...sessionUser, email: 'icylix@gmail.com', role: 'admin', authLevel: 'primary_verified' } });
      mocks.getSecuritySessionState.mockResolvedValue({ known: true, active: true });
      mocks.hasRecentSecuritySessionMfa.mockResolvedValue(false);

      const response = await requireAdmin('roles.manage');
      expect(response).toHaveProperty('status', 403);
      await expect((response as Response).json()).resolves.toEqual({ error: 'Admin MFA required', redirect: '/account/security' });
    } finally {
      if (previous === undefined) delete process.env.MFA_ADMIN_REQUIRED;
      else process.env.MFA_ADMIN_REQUIRED = previous;
    }
  });

  it('allows a financial step-up from a database session record', async () => {
    const previous = process.env.MFA_ADMIN_REQUIRED;
    process.env.MFA_ADMIN_REQUIRED = 'true';
    try {
      const user = { ...sessionUser, role: 'admin', authLevel: 'primary_verified' as const };
      mocks.hasRecentSecuritySessionMfa.mockResolvedValue(true);
      mocks.getAdminMfaPolicy.mockResolvedValue({
        required: true,
        requirement: 'admin',
        hasTotp: true,
        hasPasskey: false,
        satisfied: true,
      });

      await expect(requireAdminStepUp(user)).resolves.toEqual(user);
      expect(mocks.hasRecentSecuritySessionMfa).toHaveBeenCalledWith('user-1', 'session-1');
    } finally {
      if (previous === undefined) delete process.env.MFA_ADMIN_REQUIRED;
      else process.env.MFA_ADMIN_REQUIRED = previous;
    }
  });

  it('requires an enabled authenticator even when the JWT MFA claim is recent', async () => {
    const previous = process.env.MFA_ADMIN_REQUIRED;
    process.env.MFA_ADMIN_REQUIRED = 'true';
    try {
      mocks.auth.mockResolvedValue({ user: {
        ...sessionUser,
        email: 'icylix@gmail.com',
        role: 'admin',
        authLevel: 'mfa_verified',
        mfaVerifiedAt: Date.now(),
        mfaMethod: 'totp',
      } });
      mocks.getSecuritySessionState.mockResolvedValue({ known: true, active: true });
      mocks.getAdminMfaPolicy.mockResolvedValue({
        required: true,
        requirement: 'super_admin',
        hasTotp: false,
        hasPasskey: false,
        satisfied: false,
      });

      const response = await requireAdmin('orders.write');
      expect(response).toHaveProperty('status', 403);
      await expect((response as Response).json()).resolves.toEqual({ error: 'Admin authenticator policy required', redirect: '/account/security' });
    } finally {
      if (previous === undefined) delete process.env.MFA_ADMIN_REQUIRED;
      else process.env.MFA_ADMIN_REQUIRED = previous;
    }
  });

  it('allows a recent JWT claim only when the authenticator remains enabled', async () => {
    const previous = process.env.MFA_ADMIN_REQUIRED;
    process.env.MFA_ADMIN_REQUIRED = 'true';
    try {
      const user = {
        ...sessionUser,
        email: 'icylix@gmail.com',
        role: 'admin',
        authLevel: 'mfa_verified' as const,
        mfaVerifiedAt: Date.now(),
        mfaMethod: 'totp' as const,
      };
      mocks.auth.mockResolvedValue({ user });
      mocks.getSecuritySessionState.mockResolvedValue({ known: true, active: true });
      mocks.getAdminMfaPolicy.mockResolvedValue({
        required: true,
        requirement: 'super_admin',
        hasTotp: true,
        hasPasskey: true,
        satisfied: true,
      });

      await expect(requireAdmin('orders.write')).resolves.toEqual(user);
    } finally {
      if (previous === undefined) delete process.env.MFA_ADMIN_REQUIRED;
      else process.env.MFA_ADMIN_REQUIRED = previous;
    }
  });
});
