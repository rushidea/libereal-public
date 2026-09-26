import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getAdminPermissions: vi.fn(),
  listOrganizationsPendingApproval: vi.fn(),
  listOrganizationCreationAccess: vi.fn(),
  ensurePendingOrganizationApprovalNotifications: vi.fn(),
  setOrganizationCreationGrant: vi.fn(),
  writeAuditLog: vi.fn(),
  reviewOrganizationCreation: vi.fn(),
  OrganizationRbacError: class OrganizationRbacError extends Error {
    code: string;
    constructor(code: string, message = code) {
      super(message);
      this.code = code;
    }
  },
  organizationRbacErrorStatus: vi.fn(() => 400),
}));

vi.mock('@/lib/session', () => ({ requireAdmin: mocks.requireAdmin, getAdminPermissions: mocks.getAdminPermissions }));
vi.mock('@/lib/audit', () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock('@/lib/organization-service', () => ({
  listOrganizationsPendingApproval: mocks.listOrganizationsPendingApproval,
  listOrganizationCreationAccess: mocks.listOrganizationCreationAccess,
  ensurePendingOrganizationApprovalNotifications: mocks.ensurePendingOrganizationApprovalNotifications,
  setOrganizationCreationGrant: mocks.setOrganizationCreationGrant,
  reviewOrganizationCreation: mocks.reviewOrganizationCreation,
  OrganizationRbacError: mocks.OrganizationRbacError,
  organizationRbacErrorStatus: mocks.organizationRbacErrorStatus,
}));

import * as listRoute from '@/app/api/admin/organizations/route';
import * as reviewRoute from '@/app/api/admin/organizations/[id]/route';

describe('admin organization lifecycle routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminPermissions.mockResolvedValue(['organizations.read', 'organizations.write']);
    mocks.listOrganizationCreationAccess.mockResolvedValue({ grants: [], candidates: [] });
    mocks.setOrganizationCreationGrant.mockResolvedValue({ userId: 'user-1' });
  });

  it('requires the organization read permission', async () => {
    mocks.requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const response = await listRoute.GET(new Request('http://localhost/api/admin/organizations'));
    expect(response.status).toBe(403);
    expect(mocks.listOrganizationsPendingApproval).not.toHaveBeenCalled();
  });

  it('does not expose creation grant candidates without organization write permission', async () => {
    mocks.requireAdmin.mockResolvedValue({ id: 'platform-reader' });
    mocks.getAdminPermissions.mockResolvedValue(['organizations.read']);
    mocks.listOrganizationCreationAccess.mockResolvedValue({
      grants: [{ userId: 'user-1' }],
      candidates: [{ id: 'user-1', email: 'member@example.com', name: null }],
    });
    const response = await listRoute.GET(new Request('http://localhost/api/admin/organizations'));
    expect(response.status).toBe(200);
    expect(mocks.listOrganizationCreationAccess).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ organizationCreationGrants: [], organizationCreationCandidates: [] });
  });

  it('passes the organization creation account search to the service', async () => {
    mocks.requireAdmin.mockResolvedValue({ id: 'platform-admin' });
    mocks.listOrganizationCreationAccess.mockResolvedValue({ grants: [], candidates: [{ id: 'user-1', email: 'member@example.com', name: '成员' }] });
    const response = await listRoute.GET(new Request('http://localhost/api/admin/organizations?q=member%40example.com'));
    expect(response.status).toBe(200);
    expect(mocks.listOrganizationCreationAccess).toHaveBeenCalledWith('member@example.com');
    expect(await response.json()).toMatchObject({ organizationCreationCandidates: [{ id: 'user-1' }] });
  });

  it('lists pending creation and profile reapproval work', async () => {
    mocks.requireAdmin.mockResolvedValue({ id: 'platform-admin' });
    mocks.listOrganizationsPendingApproval.mockResolvedValue([{ id: 'org-1', status: 'pending', pendingName: null }]);
    const response = await listRoute.GET(new Request('http://localhost/api/admin/organizations'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      organizations: [{ id: 'org-1', status: 'pending', pendingName: null }],
      organizationCreationGrants: [],
      organizationCreationCandidates: [],
      canManageOrganizationCreation: true,
    });
    expect(mocks.requireAdmin).toHaveBeenCalledWith('organizations.read');
  });

  it('approves or rejects through the platform write permission', async () => {
    mocks.requireAdmin.mockResolvedValue({ id: 'platform-admin' });
    mocks.reviewOrganizationCreation.mockResolvedValue({ organizationId: 'org-1', status: 'active' });
    const response = await reviewRoute.PATCH(
      new NextRequest('http://localhost/api/admin/organizations/org-1', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'approve' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.requireAdmin).toHaveBeenCalledWith('organizations.write');
    expect(mocks.reviewOrganizationCreation).toHaveBeenCalledWith('platform-admin', 'org-1', 'approve');
  });

  it('allows a platform admin to grant organization creation to a specified user', async () => {
    mocks.requireAdmin.mockResolvedValue({ id: 'platform-admin', email: 'admin@example.com' });
    const response = await listRoute.PATCH(new NextRequest('http://localhost/api/admin/organizations', {
      method: 'PATCH',
      body: JSON.stringify({ userId: 'user-1', allowed: true }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(mocks.requireAdmin).toHaveBeenCalledWith('organizations.write');
    expect(mocks.setOrganizationCreationGrant).toHaveBeenCalledWith('user-1', 'platform-admin', true);
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'organization.creation_permission_changed',
      targetId: 'user-1',
      after: { allowed: true },
    }));
  });
});
