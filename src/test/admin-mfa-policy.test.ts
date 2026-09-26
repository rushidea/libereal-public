import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  getMfaAuthenticatorPresence: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { adminUserRole: { findFirst: mocks.findFirst } },
}));
vi.mock('@/lib/security/mfa-service', () => ({
  getMfaAuthenticatorPresence: mocks.getMfaAuthenticatorPresence,
}));

import { getAdminMfaPolicy } from '@/lib/security/admin-mfa-policy';

describe('getAdminMfaPolicy', () => {
  it('requires both TOTP and Passkey for a super administrator', async () => {
    mocks.findFirst.mockResolvedValue({ userId: 'admin-1' });
    mocks.getMfaAuthenticatorPresence.mockReturnValue({ hasTotp: true, hasPasskey: false });

    await expect(getAdminMfaPolicy('admin-1', 'admin@example.com', true)).resolves.toEqual({
      required: true,
      requirement: 'super_admin',
      hasTotp: true,
      hasPasskey: false,
      satisfied: false,
    });
  });

  it('accepts either TOTP or Passkey for a regular administrator', async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.getMfaAuthenticatorPresence.mockReturnValue({ hasTotp: false, hasPasskey: true });

    await expect(getAdminMfaPolicy('admin-2', 'staff@example.com', true)).resolves.toEqual({
      required: true,
      requirement: 'admin',
      hasTotp: false,
      hasPasskey: true,
      satisfied: true,
    });
  });

  it('reports the role requirement while enforcement is disabled', async () => {
    mocks.findFirst.mockResolvedValue({ userId: 'admin-3' });
    mocks.getMfaAuthenticatorPresence.mockClear();

    await expect(getAdminMfaPolicy('admin-3', 'admin@example.com', false)).resolves.toEqual({
      required: false,
      requirement: 'super_admin',
      hasTotp: false,
      hasPasskey: false,
      satisfied: true,
    });
    expect(mocks.getMfaAuthenticatorPresence).not.toHaveBeenCalled();
  });
});
