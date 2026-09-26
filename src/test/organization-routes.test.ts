import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => {
  class OrganizationRbacError extends Error {
    code: string;

    constructor(code: string, message = code) {
      super(message);
      this.code = code;
    }
  }

  return {
    OrganizationRbacError,
    requireActiveSession: vi.fn(),
    requireRecentMfaUser: vi.fn(),
    hasSecurityStepUpGrant: vi.fn(async () => true),
    consumeSecurityStepUpGrant: vi.fn(async () => true),
    isAdminMfaScenarioEnabled: vi.fn(async () => true),
    createOrganization: vi.fn(),
    canUserCreateOrganization: vi.fn(),
    deleteRejectedOrganization: vi.fn(),
    listOrganizationsForUser: vi.fn(),
    listOrganizationInvitationsForUser: vi.fn(),
    acceptOrganizationInvitation: vi.fn(),
    leaveOrganization: vi.fn(),
    updateOrganizationProfile: vi.fn(),
    requireOrganizationPermission: vi.fn(),
    requireOrganizationMemberManager: vi.fn(),
    listOrganizationMembers: vi.fn(),
    inviteOrganizationMember: vi.fn(),
    requestOrganizationRoleChange: vi.fn(),
    updateOrganizationMemberPermissions: vi.fn(),
    listOrganizationApprovals: vi.fn(),
    reviewOrganizationApproval: vi.fn(),
    organizationRbacErrorStatus: vi.fn(() => 400),
    rateLimitAsync: vi.fn(async () => ({ allowed: true, remaining: 2, resetIn: 300000 })),
    sendAdminOperationalEmail: vi.fn(),
  };
});

vi.mock('@/lib/session', () => ({
  requireActiveSession: mocks.requireActiveSession,
  requireRecentMfaUser: mocks.requireRecentMfaUser,
}));

vi.mock('@/lib/security/security-step-up', () => ({
  hasSecurityStepUpGrant: mocks.hasSecurityStepUpGrant,
  consumeSecurityStepUpGrant: mocks.consumeSecurityStepUpGrant,
}));

vi.mock('@/lib/organization-service', () => ({
  OrganizationRbacError: mocks.OrganizationRbacError,
  createOrganization: mocks.createOrganization,
  canUserCreateOrganization: mocks.canUserCreateOrganization,
  deleteRejectedOrganization: mocks.deleteRejectedOrganization,
  listOrganizationsForUser: mocks.listOrganizationsForUser,
  listOrganizationInvitationsForUser: mocks.listOrganizationInvitationsForUser,
  acceptOrganizationInvitation: mocks.acceptOrganizationInvitation,
  leaveOrganization: mocks.leaveOrganization,
  updateOrganizationProfile: mocks.updateOrganizationProfile,
  requireOrganizationPermission: mocks.requireOrganizationPermission,
  requireOrganizationMemberManager: mocks.requireOrganizationMemberManager,
  listOrganizationMembers: mocks.listOrganizationMembers,
  inviteOrganizationMember: mocks.inviteOrganizationMember,
  requestOrganizationRoleChange: mocks.requestOrganizationRoleChange,
  updateOrganizationMemberPermissions: mocks.updateOrganizationMemberPermissions,
  listOrganizationApprovals: mocks.listOrganizationApprovals,
  reviewOrganizationApproval: mocks.reviewOrganizationApproval,
  organizationRbacErrorStatus: mocks.organizationRbacErrorStatus,
}));

vi.mock('@/lib/rateLimit', () => ({ rateLimitAsync: mocks.rateLimitAsync }));
vi.mock('@/lib/mail', () => ({ sendAdminOperationalEmail: mocks.sendAdminOperationalEmail }));
vi.mock('@/lib/admin-mfa-settings', () => ({ isAdminMfaScenarioEnabled: mocks.isAdminMfaScenarioEnabled }));

import * as organizationsRoute from '@/app/api/organizations/route';
import * as membersRoute from '@/app/api/organizations/[id]/members/route';
import * as memberRoute from '@/app/api/organizations/[id]/members/[memberId]/route';
import * as approvalsRoute from '@/app/api/organizations/[id]/approvals/[approvalId]/route';
import * as profileRoute from '@/app/api/organizations/[id]/route';

const user = {
  id: 'user-1',
  email: 'owner@example.com',
  role: 'customer',
  authLevel: 'mfa_verified' as const,
  mfaVerifiedAt: Date.now(),
  sessionId: 'session-1',
};

function request(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('organization routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rateLimitAsync.mockResolvedValue({ allowed: true, remaining: 2, resetIn: 300000 });
    mocks.canUserCreateOrganization.mockResolvedValue(true);
    mocks.organizationRbacErrorStatus.mockReturnValue(400);
  });

  it('rejects unauthenticated organization reads', async () => {
    mocks.requireActiveSession.mockResolvedValue(NextResponse.json({ error: '未登录' }, { status: 401 }));
    const response = await organizationsRoute.GET();
    expect(response.status).toBe(401);
  });

  it('creates an organization with an active session and validates the name', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.createOrganization.mockRejectedValueOnce(new mocks.OrganizationRbacError('INVALID_NAME', '组织名称长度必须为 2 到 100 个字符'));
    const invalid = await organizationsRoute.POST(request('http://localhost/api/organizations', { name: 'x' }));
    expect(invalid.status).toBe(400);

    mocks.createOrganization.mockResolvedValue({ id: 'org-1', name: '实验室', status: 'active' });
    const response = await organizationsRoute.POST(request('http://localhost/api/organizations', { name: '实验室' }));
    expect(response.status).toBe(201);
    expect(mocks.createOrganization).toHaveBeenLastCalledWith('user-1', '实验室');
    expect(mocks.sendAdminOperationalEmail).toHaveBeenCalledWith(expect.objectContaining({
      path: '/admin/organizations',
      subject: 'LIBEREAL · 新组织审核申请',
    }));
  });

  it('allows the owner to delete a rejected organization with an active session', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.deleteRejectedOrganization.mockResolvedValue({ organizationId: 'org-1', status: 'deleted' });
    const response = await profileRoute.DELETE(
      new NextRequest('http://localhost/api/organizations/org-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.deleteRejectedOrganization).toHaveBeenCalledWith('user-1', 'org-1');
  });

  it('scopes member reads and invitations to organization permissions', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.requireOrganizationMemberManager.mockResolvedValue({ id: 'member-1' });
    mocks.listOrganizationMembers.mockResolvedValue([{ id: 'member-1' }]);
    const members = await membersRoute.GET(
      new NextRequest('http://localhost/api/organizations/org-1/members'),
      { params: Promise.resolve({ id: 'org-1' }) },
    );
    expect(members.status).toBe(200);
    expect(await members.json()).toEqual({ members: [{ id: 'member-1' }] });

    mocks.inviteOrganizationMember.mockResolvedValue({ id: 'approval-1', status: 'pending' });
    mocks.requireOrganizationMemberManager.mockResolvedValue({ id: 'member-owner' });
    const invitation = await membersRoute.POST(
      request('http://localhost/api/organizations/org-1/members', { email: 'member@example.com', role: 'researcher' }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );
    expect(invitation.status).toBe(201);
    expect(mocks.inviteOrganizationMember).toHaveBeenCalledWith('user-1', 'org-1', 'member@example.com', 'researcher');
    expect(mocks.requireRecentMfaUser).not.toHaveBeenCalled();
  });

  it('returns 429 when member invitations exceed the user limit', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.rateLimitAsync.mockResolvedValue({ allowed: false, remaining: 0, resetIn: 120000 });

    const response = await membersRoute.POST(
      request('http://localhost/api/organizations/org-1/members', { email: 'member@example.com', role: 'researcher' }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(mocks.inviteOrganizationMember).not.toHaveBeenCalled();
  });

  it('reviews an approval with an active session', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.requireOrganizationPermission.mockResolvedValue({ id: 'member-owner' });
    mocks.reviewOrganizationApproval.mockResolvedValue({ id: 'approval-1', status: 'approved' });
    const response = await approvalsRoute.PATCH(
      request('http://localhost/api/organizations/org-1/approvals/approval-1', { action: 'approve' }),
      { params: Promise.resolve({ id: 'org-1', approvalId: 'approval-1' }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.reviewOrganizationApproval).toHaveBeenCalledWith('user-1', 'org-1', 'approval-1', 'approve');
  });

  it('maps member role permission errors to 403', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.requireOrganizationPermission.mockRejectedValue(new mocks.OrganizationRbacError('PERMISSION_DENIED', '组织权限不足'));
    mocks.organizationRbacErrorStatus.mockReturnValue(403);
    const response = await memberRoute.PATCH(
      request('http://localhost/api/organizations/org-1/members/member-1', { role: 'researcher', stepUpToken: 'grant-1' }),
      { params: Promise.resolve({ id: 'org-1', memberId: 'member-1' }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.requestOrganizationRoleChange).not.toHaveBeenCalled();
  });

  it('lets the organization owner update a member permission set', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.requireOrganizationPermission.mockResolvedValue({ id: 'member-owner' });
    mocks.updateOrganizationMemberPermissions.mockResolvedValue({ memberId: 'member-1', permissions: ['organization.orders.create'] });
    const response = await memberRoute.PATCH(
      request('http://localhost/api/organizations/org-1/members/member-1', { permissions: ['organization.orders.create'], stepUpToken: 'grant-1' }),
      { params: Promise.resolve({ id: 'org-1', memberId: 'member-1' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.updateOrganizationMemberPermissions).toHaveBeenCalledWith('user-1', 'org-1', 'member-1', ['organization.orders.create']);
  });

  it('requires a step-up grant for member permission changes when the scenario is enabled', async () => {
    mocks.isAdminMfaScenarioEnabled.mockResolvedValue(true);
    mocks.requireActiveSession.mockResolvedValue(user);

    const response = await memberRoute.PATCH(
      request('http://localhost/api/organizations/org-1/members/member-1', { permissions: ['organization.orders.create'] }),
      { params: Promise.resolve({ id: 'org-1', memberId: 'member-1' }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.requireActiveSession).toHaveBeenCalled();
    expect(mocks.requireRecentMfaUser).not.toHaveBeenCalled();
    expect(mocks.updateOrganizationMemberPermissions).not.toHaveBeenCalled();
  });

  it('uses only an active session for member permission changes when the scenario is disabled', async () => {
    mocks.isAdminMfaScenarioEnabled.mockResolvedValue(false);
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.requireOrganizationPermission.mockResolvedValue({ id: 'member-1' });
    mocks.updateOrganizationMemberPermissions.mockResolvedValue({ memberId: 'member-1', permissions: ['organization.orders.create'] });

    const response = await memberRoute.PATCH(
      request('http://localhost/api/organizations/org-1/members/member-1', { permissions: ['organization.orders.create'] }),
      { params: Promise.resolve({ id: 'org-1', memberId: 'member-1' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.requireActiveSession).toHaveBeenCalled();
    expect(mocks.requireRecentMfaUser).not.toHaveBeenCalled();
    expect(mocks.updateOrganizationMemberPermissions).toHaveBeenCalledWith('user-1', 'org-1', 'member-1', ['organization.orders.create']);
  });

  it('maps owner role protection errors to 403', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.requireOrganizationPermission.mockResolvedValue({ id: 'member-1' });
    mocks.requestOrganizationRoleChange.mockRejectedValue(new mocks.OrganizationRbacError('OWNER_ROLE_CHANGE_FORBIDDEN', '组织所有者角色不可修改'));
    mocks.organizationRbacErrorStatus.mockReturnValue(403);
    const response = await memberRoute.PATCH(
      request('http://localhost/api/organizations/org-1/members/member-1', { role: 'researcher', stepUpToken: 'grant-1' }),
      { params: Promise.resolve({ id: 'org-1', memberId: 'member-1' }) },
    );
    expect(response.status).toBe(403);
  });

  it('maps missing organization membership to 404', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.requireOrganizationMemberManager.mockRejectedValue(new mocks.OrganizationRbacError('MEMBERSHIP_NOT_FOUND', '组织成员关系不存在'));
    mocks.organizationRbacErrorStatus.mockReturnValue(404);
    const response = await membersRoute.GET(
      new NextRequest('http://localhost/api/organizations/org-missing/members'),
      { params: Promise.resolve({ id: 'org-missing' }) },
    );
    expect(response.status).toBe(404);
  });

  it('maps duplicate approval state to 409', async () => {
    mocks.requireRecentMfaUser.mockResolvedValue(user);
    mocks.requireOrganizationPermission.mockResolvedValue({ id: 'member-1' });
    mocks.reviewOrganizationApproval.mockRejectedValue(new mocks.OrganizationRbacError('APPROVAL_ALREADY_REVIEWED', '审核请求已经处理'));
    mocks.organizationRbacErrorStatus.mockReturnValue(409);
    const response = await approvalsRoute.PATCH(
      request('http://localhost/api/organizations/org-1/approvals/approval-1', { action: 'approve' }),
      { params: Promise.resolve({ id: 'org-1', approvalId: 'approval-1' }) },
    );
    expect(response.status).toBe(409);
  });

  it('requires recent MFA and the owner-only profile permission for organization edits', async () => {
    mocks.requireRecentMfaUser.mockResolvedValue(user);
    mocks.requireOrganizationPermission.mockResolvedValue({ id: 'member-1' });
    mocks.updateOrganizationProfile.mockResolvedValue({ id: 'org-1', name: '旧名称', pendingName: '新名称', status: 'pending_reapproval' });

    const response = await profileRoute.PATCH(
      request('http://localhost/api/organizations/org-1', { name: '新名称' }),
      { params: Promise.resolve({ id: 'org-1' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.requireOrganizationPermission).toHaveBeenCalledWith('user-1', 'org-1', 'organization.profile.edit');
    expect(mocks.updateOrganizationProfile).toHaveBeenCalledWith('user-1', 'org-1', { name: '新名称' });
    expect(mocks.sendAdminOperationalEmail).toHaveBeenCalledWith(expect.objectContaining({
      path: '/admin/organizations',
      subject: 'LIBEREAL · 组织名称修改审核申请',
    }));
  });
});
