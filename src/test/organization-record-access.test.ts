import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listOrganizationIdsForPermission: vi.fn(),
  requireOrganizationPermission: vi.fn(),
}));

vi.mock('@/lib/organization-service', () => ({
  OrganizationRbacError: class OrganizationRbacError extends Error {
    code: string;
    constructor(code: string, message = code) {
      super(message);
      this.code = code;
    }
  },
  listOrganizationIdsForPermission: mocks.listOrganizationIdsForPermission,
  requireOrganizationPermission: mocks.requireOrganizationPermission,
}));

import { canAccessOrganizationRecord, resolveRecordOwnership } from '@/lib/organization-record-access';

describe('organization record access', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults records without organization context to personal ownership', async () => {
    await expect(resolveRecordOwnership('user-1', undefined, 'organization.orders.create'))
      .resolves.toEqual({ organizationId: null, ownerScope: 'personal' });
    expect(mocks.requireOrganizationPermission).not.toHaveBeenCalled();
  });

  it('requires active organization permission before marking a record organization-owned', async () => {
    mocks.requireOrganizationPermission.mockResolvedValue({ id: 'member-1' });

    await expect(resolveRecordOwnership('user-1', 'org-a', 'organization.orders.create'))
      .resolves.toEqual({ organizationId: 'org-a', ownerScope: 'organization' });
    expect(mocks.requireOrganizationPermission).toHaveBeenCalledWith('user-1', 'org-a', 'organization.orders.create');
  });

  it('allows the original owner or authorized administrator through organization permission', async () => {
    mocks.listOrganizationIdsForPermission.mockResolvedValue(['org-a']);
    await expect(canAccessOrganizationRecord('admin-1', 'org-a')).resolves.toBe(true);

    mocks.listOrganizationIdsForPermission.mockResolvedValue([]);
    await expect(canAccessOrganizationRecord('member-1', 'org-a')).resolves.toBe(false);
  });

  it('denies the exited creator even when the organization record remains attached to the original organization', async () => {
    mocks.listOrganizationIdsForPermission.mockResolvedValue([]);

    await expect(canAccessOrganizationRecord('former-member', 'org-a')).resolves.toBe(false);
    expect(mocks.listOrganizationIdsForPermission).toHaveBeenCalledWith('former-member', 'organization.records.read');
  });
});
