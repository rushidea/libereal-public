import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  systemSettings: { findUnique: vi.fn(), upsert: vi.fn() },
  organizationCreationGrant: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  organization: { findMany: vi.fn() },
  notification: { findMany: vi.fn(), upsert: vi.fn() },
  sendOrganizationNotificationEmail: vi.fn(),
  transaction: vi.fn(),
  tx: {
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    organizationMember: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    organizationApprovalRequest: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    organizationRoleAssignment: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    organizationMemberPermission: {
      deleteMany: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    organizationRole: { findUnique: vi.fn(), create: vi.fn() },
    securityEvent: { create: vi.fn() },
    notification: { create: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    systemSettings: mocks.systemSettings,
    organizationCreationGrant: mocks.organizationCreationGrant,
    organization: mocks.organization,
    notification: mocks.notification,
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/mail', () => ({
  sendOrganizationNotificationEmail: mocks.sendOrganizationNotificationEmail,
}));

import {
  acceptOrganizationInvitation,
  createOrganization,
  deleteRejectedOrganization,
  ensurePendingOrganizationApprovalNotifications,
  inviteOrganizationMember,
  leaveOrganization,
  requestOrganizationRoleChange,
  reviewOrganizationApproval,
  reviewOrganizationCreation,
  updateOrganizationProfile,
  updateOrganizationMemberPermissions,
  canUserCreateOrganization,
  setOrganizationCreationGrant,
} from '@/lib/organization-service';

const ownerRequester = {
  status: 'active',
    organization: { name: '实验室', ownerUserId: 'owner-1', status: 'active' },
  roleAssignments: [{ role: { key: 'owner' } }],
};

function pendingRoleApproval(roleKey = 'researcher') {
  return {
    id: 'approval-1',
    organizationId: 'org-1',
    requesterUserId: 'admin-1',
    kind: 'role_change',
    status: 'pending',
    payload: JSON.stringify({ roleKey }),
    organization: { status: 'active', ownerUserId: 'owner-1' },
    member: { id: 'member-1', userId: 'member-1-user', status: 'active', roleAssignments: [] },
  };
}

function pendingExitApproval() {
  return {
    id: 'exit-approval-1',
    organizationId: 'org-1',
    requesterUserId: 'member-1-user',
    kind: 'member_exit',
    status: 'pending',
    payload: JSON.stringify({ reason: 'member_requested_exit' }),
    organization: { status: 'active', ownerUserId: 'owner-1' },
    member: {
      id: 'member-1',
      userId: 'member-1-user',
      status: 'active',
      user: { email: 'member@example.com', name: '成员' },
      roleAssignments: [{ role: { key: 'researcher' } }],
    },
  };
}

describe('organization service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => unknown) => callback(mocks.tx));
    mocks.tx.organizationApprovalRequest.updateMany.mockResolvedValue({ count: 1 });
    mocks.tx.organizationApprovalRequest.create.mockResolvedValue({ id: 'approval-1', kind: 'role_change', status: 'pending', createdAt: new Date() });
    mocks.tx.organizationMember.update.mockResolvedValue({ id: 'member-1' });
    mocks.tx.organizationRoleAssignment.deleteMany.mockResolvedValue({ count: 1 });
    mocks.tx.organizationRoleAssignment.create.mockResolvedValue({});
    mocks.tx.securityEvent.create.mockResolvedValue({});
    mocks.tx.notification.create.mockResolvedValue({});
    mocks.tx.organization.delete.mockResolvedValue({ id: 'org-1' });
    mocks.tx.organizationMemberPermission.deleteMany.mockResolvedValue({ count: 1 });
    mocks.tx.organizationMemberPermission.upsert.mockResolvedValue({});
    mocks.tx.organizationMemberPermission.findMany.mockResolvedValue([]);
    mocks.systemSettings.findUnique.mockResolvedValue({ organizationCreationEnabled: true, updatedAt: new Date() });
    mocks.organizationCreationGrant.findUnique.mockResolvedValue({ userId: 'owner-1' });
    mocks.organizationCreationGrant.upsert.mockResolvedValue({ userId: 'owner-1', createdAt: new Date() });
    mocks.organizationCreationGrant.deleteMany.mockResolvedValue({ count: 1 });
    mocks.organization.findMany.mockResolvedValue([]);
    mocks.notification.findMany.mockResolvedValue([]);
    mocks.notification.upsert.mockResolvedValue({});
  });

  it('creates a pending organization with one owner and records the lifecycle event', async () => {
    mocks.tx.organization.create.mockResolvedValue({ id: 'org-1', name: '实验室', status: 'pending' });
    mocks.tx.organizationRole.create = vi.fn()
      .mockResolvedValueOnce({ id: 'role-owner' })
      .mockResolvedValue({ id: 'role-other' });
    mocks.tx.organizationMember.create.mockResolvedValue({ id: 'member-1' });

    const result = await createOrganization('owner-1', '实验室');

    expect(result).toEqual({ id: 'org-1', name: '实验室', status: 'pending' });
    expect(mocks.tx.organizationMember.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', userId: 'owner-1', status: 'active', joinedAt: expect.any(Date) },
      select: { id: true },
    });
    expect(mocks.tx.securityEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'ORGANIZATION_CREATED' }),
    }));
    expect(mocks.tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: 'admin',
        role: 'admin',
        type: 'organization_approval_requested',
        linkUrl: '/admin/organizations',
      }),
    }));
  });

  it('does not create an organization while the platform creation switch is closed', async () => {
    mocks.organizationCreationGrant.findUnique.mockResolvedValue(null);

    await expect(createOrganization('owner-1', '实验室'))
      .rejects.toMatchObject({ code: 'ORGANIZATION_CREATION_DISABLED' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('checks organization creation access per user', async () => {
    mocks.organizationCreationGrant.findUnique.mockResolvedValueOnce({ userId: 'owner-1' }).mockResolvedValueOnce(null);
    await expect(canUserCreateOrganization('owner-1')).resolves.toBe(true);
    await expect(canUserCreateOrganization('member-1')).resolves.toBe(false);
  });

  it('grants and revokes organization creation access for a specified user', async () => {
    mocks.userFindUnique.mockResolvedValue({ id: 'member-1' });
    await setOrganizationCreationGrant('member-1', 'platform-admin', true);
    expect(mocks.organizationCreationGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'member-1' },
      create: { userId: 'member-1', grantedByUserId: 'platform-admin' },
    }));
    await setOrganizationCreationGrant('member-1', 'platform-admin', false);
    expect(mocks.organizationCreationGrant.deleteMany).toHaveBeenCalledWith({ where: { userId: 'member-1' } });
  });

  it('backfills missing notifications for pending organization review', async () => {
    mocks.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: '已存在通知', pendingName: null, status: 'pending' },
      { id: 'org-2', name: '资料待复核', pendingName: '新名称', status: 'pending_reapproval' },
    ]);
    mocks.notification.findMany.mockResolvedValue([
      {
        type: 'organization_approval_requested',
        metadata: JSON.stringify({ organizationId: 'org-1' }),
      },
    ]);

    await ensurePendingOrganizationApprovalNotifications();

    expect(mocks.notification.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.notification.upsert).toHaveBeenCalledWith({
      where: { id: 'organization-approval-reapproval-org-2' },
      create: expect.objectContaining({
        id: 'organization-approval-reapproval-org-2',
        type: 'organization_profile_approval_requested',
        linkUrl: '/admin/organizations',
        metadata: expect.stringContaining('org-2'),
      }),
      update: {},
    });
  });

  it('lets the owner invite without creating a second approval request', async () => {
    mocks.userFindUnique.mockResolvedValue({ id: 'invitee-1', email: 'member@example.com', name: '成员' });
    mocks.tx.organizationMember.findUnique
      .mockResolvedValueOnce(ownerRequester)
      .mockResolvedValueOnce(null);
    mocks.tx.organizationMember.create.mockResolvedValue({ id: 'member-1' });

    const result = await inviteOrganizationMember('owner-1', 'org-1', 'member@example.com', 'researcher');

    expect(result).toMatchObject({ memberId: 'member-1', roleKey: 'researcher', status: 'pending', requiresAcceptance: true });
    expect(mocks.tx.organizationApprovalRequest.create).not.toHaveBeenCalled();
    expect(mocks.tx.organizationMember.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', userId: 'invitee-1', status: 'pending', pendingRoleKey: 'researcher' },
      select: { id: true },
    });
    expect(mocks.tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'invitee-1',
        email: 'member@example.com',
        type: 'organization_invitation',
        linkUrl: '/account/organizations',
        metadata: expect.stringContaining('org-1'),
      }),
    });
  });

  it('maps a concurrent membership unique conflict to a retryable client error', async () => {
    mocks.userFindUnique.mockResolvedValue({ id: 'invitee-1', email: 'member@example.com', name: null });
    mocks.tx.organizationMember.findUnique
      .mockResolvedValueOnce(ownerRequester)
      .mockResolvedValueOnce(null);
    mocks.tx.organizationMember.create.mockRejectedValue({ code: 'P2002' });

    await expect(inviteOrganizationMember('owner-1', 'org-1', 'member@example.com', 'researcher'))
      .rejects.toMatchObject({ code: 'MEMBER_EXISTS' });
  });

  it('accepts an invitation only for the invited account and assigns the pending role', async () => {
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      id: 'member-1',
      status: 'pending',
      pendingRoleKey: 'researcher',
      organization: { id: 'org-1', name: '实验室', status: 'active' },
    });
    mocks.tx.organizationRole.findUnique.mockResolvedValue({ id: 'role-researcher' });

    const result = await acceptOrganizationInvitation('invitee-1', 'org-1');

    expect(result).toMatchObject({ organizationId: 'org-1', roleKey: 'researcher', status: 'active' });
    expect(mocks.tx.organizationMember.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'member-1' },
      data: expect.objectContaining({ status: 'active', pendingRoleKey: null }),
    }));
    expect(mocks.tx.organizationRoleAssignment.create).toHaveBeenCalledWith({
      data: { memberId: 'member-1', roleId: 'role-researcher', assignedBy: 'invitee-1' },
    });
  });

  it('falls back to the researcher role for a legacy invitation without a role', async () => {
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      id: 'member-legacy',
      status: 'pending',
      pendingRoleKey: null,
      organization: { id: 'org-1', name: '实验室', status: 'active' },
    });
    mocks.tx.organizationRole.findUnique.mockResolvedValue({ id: 'role-researcher' });

    const result = await acceptOrganizationInvitation('invitee-1', 'org-1');

    expect(result).toMatchObject({ roleKey: 'researcher', status: 'active' });
    expect(mocks.tx.organizationRole.findUnique).toHaveBeenCalledWith({
      where: { organizationId_key: { organizationId: 'org-1', key: 'researcher' } },
      select: { id: true },
    });
  });

  it('blocks an invitation confirmation while organization profile reapproval is pending', async () => {
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      id: 'member-1',
      status: 'pending',
      pendingRoleKey: 'researcher',
      organization: { id: 'org-1', name: '实验室', status: 'pending_reapproval' },
    });

    await expect(acceptOrganizationInvitation('invitee-1', 'org-1'))
      .rejects.toMatchObject({ code: 'ORGANIZATION_PENDING_APPROVAL' });
  });

  it('does not let an administrator invite another administrator', async () => {
    mocks.userFindUnique.mockResolvedValue({ id: 'invitee-1', email: 'member@example.com', name: null });
    mocks.tx.organizationMember.findUnique.mockResolvedValueOnce({
      status: 'active',
      organization: { ownerUserId: 'owner-1', status: 'active' },
      roleAssignments: [{ role: { key: 'admin', name: '审计员', permissions: JSON.stringify(['organization.members.invite']) } }],
      permissionOverrides: [],
    });

    await expect(inviteOrganizationMember('admin-1', 'org-1', 'member@example.com', 'admin'))
      .rejects.toMatchObject({ code: 'OWNER_ONLY_ROLE_MANAGEMENT' });
    expect(mocks.tx.organizationMember.create).not.toHaveBeenCalled();
  });

  it('does not let an ordinary member invite another member', async () => {
    mocks.userFindUnique.mockResolvedValue({ id: 'invitee-1', email: 'member@example.com', name: null });
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      status: 'active',
      organization: { ownerUserId: 'owner-1', status: 'active' },
      roleAssignments: [{ role: { key: 'researcher', name: '研究员', permissions: JSON.stringify(['organization.members.invite']) } }],
      permissionOverrides: [],
    });

    await expect(inviteOrganizationMember('researcher-1', 'org-1', 'member@example.com', 'researcher'))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(mocks.tx.organizationMember.create).not.toHaveBeenCalled();
  });

  it('creates an owner-reviewed exit request while retaining active access', async () => {
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      id: 'member-1',
      status: 'active',
      organization: { id: 'org-1', ownerUserId: 'owner-1', status: 'active', owner: { email: 'owner@example.com' } },
    });

    await expect(leaveOrganization('member-1-user', 'org-1')).resolves.toEqual({ organizationId: 'org-1', status: 'pending_exit', approvalId: 'approval-1' });
    expect(mocks.tx.organizationMember.update).not.toHaveBeenCalled();
    expect(mocks.tx.organizationRoleAssignment.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.organizationApprovalRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: 'org-1', memberId: 'member-1', kind: 'member_exit' }),
    }));
    expect(mocks.tx.securityEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        eventType: 'ORGANIZATION_MEMBER_EXIT_REQUESTED',
      }),
    }));
    expect(mocks.tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'organization_member_exit_requested', userId: 'owner-1' }),
    }));
    expect(mocks.sendOrganizationNotificationEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'owner@example.com',
      subject: 'LIBEREAL · 成员退出申请待审核',
    }));
  });

  it('prevents the sole owner from leaving', async () => {
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      id: 'owner-member',
      status: 'active',
      organization: { id: 'org-1', ownerUserId: 'owner-1', status: 'active' },
    });

    await expect(leaveOrganization('owner-1', 'org-1')).rejects.toMatchObject({ code: 'OWNER_CANNOT_LEAVE' });
    expect(mocks.tx.organizationMember.update).not.toHaveBeenCalled();
  });

  it('applies an owner role change immediately and reserves admin assignment for the owner', async () => {
    mocks.tx.organizationMember.findUnique.mockResolvedValue(ownerRequester);
    mocks.tx.organizationMember.findFirst.mockResolvedValue({
      id: 'member-1',
      userId: 'member-1-user',
      organization: { ownerUserId: 'owner-1' },
      roleAssignments: [{ role: { key: 'researcher' } }],
    });
    mocks.tx.organizationRole.findUnique.mockResolvedValue({ id: 'role-admin' });

    const result = await requestOrganizationRoleChange('owner-1', 'org-1', 'member-1', 'admin');

    expect(result).toMatchObject({ memberId: 'member-1', roleKey: 'admin', applied: true });
    expect(mocks.tx.organizationApprovalRequest.create).not.toHaveBeenCalled();
    expect(mocks.tx.organizationMemberPermission.deleteMany).toHaveBeenCalledWith({ where: { memberId: 'member-1' } });
    expect(mocks.tx.securityEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'ORGANIZATION_ROLE_CHANGED' }),
    }));
  });

  it('does not let an administrator downgrade another administrator', async () => {
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      status: 'active',
      organization: { ownerUserId: 'owner-1', status: 'active' },
      roleAssignments: [{ role: { key: 'admin' } }],
    });
    mocks.tx.organizationMember.findFirst.mockResolvedValue({
      id: 'member-1',
      userId: 'other-admin',
      organization: { ownerUserId: 'owner-1' },
      roleAssignments: [{ role: { key: 'admin' } }],
    });

    await expect(requestOrganizationRoleChange('admin-1', 'org-1', 'member-1', 'researcher'))
      .rejects.toMatchObject({ code: 'OWNER_ONLY_ROLE_MANAGEMENT' });
    expect(mocks.tx.organizationApprovalRequest.create).not.toHaveBeenCalled();
  });

  it('requires an owner review for an administrator role approval', async () => {
    mocks.tx.organizationApprovalRequest.findFirst.mockResolvedValue(pendingRoleApproval('admin'));
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      status: 'active',
      roleAssignments: [{ role: { key: 'admin', name: '审计员', permissions: JSON.stringify(['organization.approvals.review']) } }],
      permissionOverrides: [],
    });

    await expect(reviewOrganizationApproval('other-admin', 'org-1', 'approval-1', 'approve'))
      .rejects.toMatchObject({ code: 'OWNER_ONLY_ROLE_MANAGEMENT' });
  });

  it('reviews a non-owner role change atomically', async () => {
    mocks.tx.organizationApprovalRequest.findFirst.mockResolvedValue(pendingRoleApproval('researcher'));
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      status: 'active',
      roleAssignments: [{ role: { key: 'admin', name: '审计员', permissions: JSON.stringify(['organization.approvals.review']) } }],
      permissionOverrides: [],
    });
    mocks.tx.organizationRole.findUnique.mockResolvedValue({ id: 'role-researcher' });

    const result = await reviewOrganizationApproval('reviewer-1', 'org-1', 'approval-1', 'approve');

    expect(result).toMatchObject({ id: 'approval-1', status: 'approved' });
    expect(mocks.tx.organizationApprovalRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'approval-1', organizationId: 'org-1', status: 'pending' },
    }));
    expect(mocks.tx.organizationRoleAssignment.create).toHaveBeenCalledWith({
      data: { memberId: 'member-1', roleId: 'role-researcher', assignedBy: 'reviewer-1' },
    });
    expect(mocks.tx.organizationMemberPermission.deleteMany).toHaveBeenCalledWith({ where: { memberId: 'member-1' } });
  });

  it('lets only the owner approve a member exit and revokes access after approval', async () => {
    mocks.tx.organizationApprovalRequest.findFirst.mockResolvedValue(pendingExitApproval());
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      status: 'active',
      roleAssignments: [{ role: { key: 'owner', name: '组织所有者', permissions: JSON.stringify([]) } }],
      permissionOverrides: [],
    });

    const result = await reviewOrganizationApproval('owner-1', 'org-1', 'exit-approval-1', 'approve');

    expect(result).toMatchObject({ id: 'exit-approval-1', kind: 'member_exit', status: 'approved' });
    expect(mocks.tx.organizationMember.update).toHaveBeenCalledWith({
      where: { id: 'member-1' },
      data: { status: 'removed', joinedAt: null, pendingRoleKey: null },
    });
    expect(mocks.tx.organizationRoleAssignment.deleteMany).toHaveBeenCalledWith({ where: { memberId: 'member-1' } });
    expect(mocks.tx.organizationMemberPermission.deleteMany).toHaveBeenCalledWith({ where: { memberId: 'member-1' } });
  });

  it('does not let an administrator approve a member exit', async () => {
    mocks.tx.organizationApprovalRequest.findFirst.mockResolvedValue(pendingExitApproval());
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      status: 'active',
      roleAssignments: [{ role: { key: 'admin', name: '审计员', permissions: JSON.stringify(['organization.approvals.review']) } }],
      permissionOverrides: [],
    });

    await expect(reviewOrganizationApproval('admin-1', 'org-1', 'exit-approval-1', 'approve'))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(mocks.tx.organizationMember.update).not.toHaveBeenCalled();
  });

  it('lets the owner submit a name change into pending reapproval', async () => {
    mocks.tx.organization.findUnique.mockResolvedValue({ id: 'org-1', name: '旧名称', ownerUserId: 'owner-1', status: 'active', pendingName: null });
    mocks.tx.organization.update.mockResolvedValue({ id: 'org-1', name: '旧名称', pendingName: '新名称', status: 'pending_reapproval' });

    const result = await updateOrganizationProfile('owner-1', 'org-1', { name: '新名称' });

    expect(result).toEqual({ id: 'org-1', name: '旧名称', pendingName: '新名称', status: 'pending_reapproval' });
    expect(mocks.tx.securityEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'ORGANIZATION_PROFILE_CHANGE_REQUESTED' }),
    }));
    expect(mocks.tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        email: 'admin',
        role: 'admin',
        type: 'organization_profile_approval_requested',
        linkUrl: '/admin/organizations',
      }),
    }));
  });

  it('lets the owner delete a rejected organization and records the event', async () => {
    mocks.tx.organization.findUnique.mockResolvedValue({ id: 'org-1', name: '待删除组织', ownerUserId: 'owner-1', status: 'rejected' });

    await expect(deleteRejectedOrganization('owner-1', 'org-1')).resolves.toEqual({ organizationId: 'org-1', status: 'deleted' });
    expect(mocks.tx.organization.delete).toHaveBeenCalledWith({ where: { id: 'org-1' } });
    expect(mocks.tx.securityEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'ORGANIZATION_DELETED' }),
    }));
  });

  it('does not let the owner delete an organization before platform review', async () => {
    mocks.tx.organization.findUnique
      .mockResolvedValueOnce({ id: 'org-1', name: '待审核组织', ownerUserId: 'owner-1', status: 'pending' })
      .mockResolvedValueOnce({ id: 'org-2', name: '待重新审核组织', ownerUserId: 'owner-1', status: 'pending_reapproval' });

    await expect(deleteRejectedOrganization('owner-1', 'org-1'))
      .rejects.toMatchObject({ code: 'ORGANIZATION_DELETE_FORBIDDEN' });
    await expect(deleteRejectedOrganization('owner-1', 'org-2'))
      .rejects.toMatchObject({ code: 'ORGANIZATION_DELETE_FORBIDDEN' });
    expect(mocks.tx.organization.delete).not.toHaveBeenCalled();
  });

  it('lets the owner add order creation permission to a researcher', async () => {
    const allOwnerPermissions = JSON.stringify([
      'organization.read', 'organization.members.read', 'organization.members.invite', 'organization.members.manage',
      'organization.roles.manage', 'organization.profile.edit', 'organization.records.read', 'organization.approvals.read',
      'organization.approvals.review', 'organization.settings.manage', 'organization.orders.create', 'organization.orders.review',
      'organization.inquiries.create', 'organization.pricing.read',
    ]);
    mocks.tx.organization.findUnique.mockResolvedValue({ ownerUserId: 'owner-1', status: 'active' });
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      id: 'owner-member',
      status: 'active',
      roleAssignments: [{ role: { key: 'owner', name: '组织所有者', permissions: allOwnerPermissions } }],
      permissionOverrides: [],
    });
    mocks.tx.organizationMember.findFirst.mockResolvedValue({
      id: 'member-1',
      userId: 'researcher-1',
      roleAssignments: [{ role: { key: 'researcher', name: '研究员', permissions: JSON.stringify(['organization.read', 'organization.members.read', 'organization.inquiries.create', 'organization.pricing.read']) } }],
      permissionOverrides: [],
    });
    mocks.tx.organizationMemberPermission.findMany.mockResolvedValue([{ permission: 'organization.orders.create', granted: true }]);

    const result = await updateOrganizationMemberPermissions('owner-1', 'org-1', 'member-1', [
      'organization.read', 'organization.members.read', 'organization.inquiries.create', 'organization.pricing.read', 'organization.orders.create',
    ]);

    expect(result.permissions).toContain('organization.orders.create');
    expect(mocks.tx.organizationMemberPermission.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { memberId_permission: { memberId: 'member-1', permission: 'organization.orders.create' } },
      create: expect.objectContaining({ granted: true, assignedBy: 'owner-1' }),
    }));
  });

  it('does not let a non-admin member change another member permissions', async () => {
    mocks.tx.organization.findUnique.mockResolvedValue({ ownerUserId: 'owner-1', status: 'active' });
    const managerPermissions = JSON.stringify(['organization.read', 'organization.members.read', 'organization.members.manage', 'organization.orders.review', 'organization.inquiries.create', 'organization.pricing.read']);
    const researcherPermissions = JSON.stringify(['organization.read', 'organization.members.read', 'organization.inquiries.create', 'organization.pricing.read']);
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      id: 'manager-member',
      status: 'active',
      roleAssignments: [{ role: { key: 'researcher', name: '研究员', permissions: managerPermissions } }],
      permissionOverrides: [],
    });
    mocks.tx.organizationMember.findFirst.mockResolvedValue({
      id: 'member-1',
      userId: 'researcher-1',
      roleAssignments: [{ role: { key: 'researcher', name: '研究员', permissions: researcherPermissions } }],
      permissionOverrides: [],
    });
    mocks.tx.organizationMemberPermission.findMany.mockResolvedValue([
      { permission: 'organization.orders.review', granted: true },
    ]);

    await expect(updateOrganizationMemberPermissions('manager-1', 'org-1', 'member-1', [
      'organization.read', 'organization.members.read', 'organization.inquiries.create', 'organization.pricing.read', 'organization.orders.review',
    ])).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('does not let a non-admin member update a lower member within its permission scope', async () => {
    mocks.tx.organization.findUnique.mockResolvedValue({ ownerUserId: 'owner-1', status: 'active' });
    const managerPermissions = JSON.stringify(['organization.read', 'organization.members.read', 'organization.members.manage', 'organization.inquiries.create', 'organization.pricing.read']);
    const lowerManagerPermissions = JSON.stringify(['organization.read', 'organization.members.read', 'organization.members.manage', 'organization.inquiries.create', 'organization.pricing.read']);
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      id: 'manager-member',
      status: 'active',
      roleAssignments: [{ role: { key: 'researcher', name: '研究员', permissions: managerPermissions } }],
      permissionOverrides: [],
    });
    mocks.tx.organizationMember.findFirst.mockResolvedValue({
      id: 'lower-member',
      userId: 'lower-1',
      roleAssignments: [{ role: { key: 'researcher', name: '研究员', permissions: lowerManagerPermissions } }],
      permissionOverrides: [],
    });
    mocks.tx.organizationMemberPermission.findMany.mockResolvedValue([]);

    await expect(updateOrganizationMemberPermissions('manager-1', 'org-1', 'lower-member', [
      'organization.read', 'organization.members.read', 'organization.inquiries.create', 'organization.pricing.read',
    ])).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(mocks.tx.organizationMemberPermission.upsert).not.toHaveBeenCalled();
  });

  it('lets an organization administrator change lower member permissions', async () => {
    mocks.tx.organization.findUnique.mockResolvedValue({ ownerUserId: 'owner-1', status: 'active' });
    const adminPermissions = JSON.stringify(['organization.read', 'organization.members.read', 'organization.members.manage', 'organization.inquiries.create', 'organization.pricing.read']);
    const researcherPermissions = JSON.stringify(['organization.read', 'organization.members.read', 'organization.inquiries.create', 'organization.pricing.read']);
    mocks.tx.organizationMember.findUnique.mockResolvedValue({
      id: 'admin-member',
      status: 'active',
      roleAssignments: [{ role: { key: 'admin', name: '审计员', permissions: adminPermissions } }],
      permissionOverrides: [],
    });
    mocks.tx.organizationMember.findFirst.mockResolvedValue({
      id: 'member-1',
      userId: 'researcher-1',
      roleAssignments: [{ role: { key: 'researcher', name: '研究员', permissions: researcherPermissions } }],
      permissionOverrides: [],
    });

    await expect(updateOrganizationMemberPermissions('admin-1', 'org-1', 'member-1', [
      'organization.read', 'organization.members.read', 'organization.inquiries.create', 'organization.pricing.read',
    ])).resolves.toMatchObject({ memberId: 'member-1' });
  });

  it('prevents an administrator from editing the organization name', async () => {
    mocks.tx.organization.findUnique.mockResolvedValue({ id: 'org-1', name: '旧名称', ownerUserId: 'owner-1', status: 'active', pendingName: null });

    await expect(updateOrganizationProfile('admin-1', 'org-1', { name: '新名称' }))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(mocks.tx.organization.update).not.toHaveBeenCalled();
  });

  it('approves a pending organization and rejects a pending reapproval without changing the old name', async () => {
    mocks.tx.organization.findUnique.mockResolvedValueOnce({ id: 'org-1', name: '实验室', pendingName: null, status: 'pending' });
    mocks.tx.organization.updateMany.mockResolvedValue({ count: 1 });
    await expect(reviewOrganizationCreation('platform-admin', 'org-1', 'approve')).resolves.toEqual({ organizationId: 'org-1', status: 'active' });

    mocks.tx.organization.findUnique.mockResolvedValueOnce({ id: 'org-1', name: '旧名称', pendingName: '新名称', status: 'pending_reapproval' });
    await expect(reviewOrganizationCreation('platform-admin', 'org-1', 'reject')).resolves.toEqual({ organizationId: 'org-1', status: 'active' });
    expect(mocks.tx.organization.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'org-1', status: 'pending_reapproval' },
      data: { pendingName: null, status: 'active' },
    });
  });
});
