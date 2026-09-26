import { prisma } from '@/lib/prisma';
import { sendOrganizationNotificationEmail } from '@/lib/mail';
import {
  isInvitableOrganizationRole,
  ORGANIZATION_MEMBER_PERMISSION_KEYS,
  isOrganizationRoleKey,
  ORGANIZATION_ROLE_DEFINITIONS,
  parseOrganizationPermissions,
  type OrganizationPermission,
  type OrganizationRoleKey,
} from '@/lib/organization-rbac';

export type OrganizationRbacErrorCode =
  | 'INVALID_NAME'
  | 'INVALID_ORGANIZATION_CONTEXT'
  | 'INVALID_ROLE'
  | 'INVALID_PERMISSION'
  | 'ORGANIZATION_NOT_FOUND'
  | 'ORGANIZATION_PENDING_APPROVAL'
  | 'ORGANIZATION_REJECTED'
  | 'ORGANIZATION_PROFILE_UNCHANGED'
  | 'ORGANIZATION_PROFILE_REAPPROVAL_REQUIRED'
  | 'ORGANIZATION_CREATION_DISABLED'
  | 'ORGANIZATION_DELETE_FORBIDDEN'
  | 'MEMBERSHIP_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'OWNER_ONLY_ROLE_MANAGEMENT'
  | 'OWNER_CANNOT_LEAVE'
  | 'MEMBERSHIP_NOT_ACTIVE'
  | 'USER_NOT_FOUND'
  | 'INVALID_EMAIL'
  | 'SELF_INVITE'
  | 'MEMBER_EXISTS'
  | 'PENDING_MEMBER'
  | 'ROLE_UNCHANGED'
  | 'INVITATION_NOT_FOUND'
  | 'TARGET_MEMBER_NOT_FOUND'
  | 'OWNER_ROLE_CHANGE_FORBIDDEN'
  | 'PENDING_APPROVAL_EXISTS'
  | 'APPROVAL_NOT_FOUND'
  | 'APPROVAL_ALREADY_REVIEWED'
  | 'INVALID_APPROVAL'
  | 'SELF_APPROVAL';

export class OrganizationRbacError extends Error {
  readonly code: OrganizationRbacErrorCode;

  constructor(code: OrganizationRbacErrorCode, message: string = code) {
    super(message);
    this.name = 'OrganizationRbacError';
    this.code = code;
  }
}

type OrganizationRoleView = {
  key: string;
  name: string;
  permissions: string;
};

type MembershipWithRoles = {
  id: string;
  organizationId: string;
  userId: string;
  status: string;
  organization: {
    id: string;
    name: string;
    status: string;
    ownerUserId: string;
  };
  roleAssignments: Array<{
    role: OrganizationRoleView;
  }>;
  permissionOverrides: Array<{
    permission: string;
    granted: boolean;
  }>;
};

export type OrganizationMembership = MembershipWithRoles;

export type OrganizationMemberView = {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  status: string;
  joinedAt: Date | null;
  createdAt: Date;
  pendingRole: string | null;
  roles: Array<{ key: string; name: string }>;
  permissions: string[];
};

export type OrganizationInvitationView = {
  id: string;
  organizationId: string;
  organizationName: string;
  requestedRole: string | null;
  invitedAt: Date;
};

export type OrganizationAdminView = {
  id: string;
  name: string;
  status: string;
  ownerUserId: string;
  owner: { id: string; email: string; name: string | null };
  createdAt: Date;
  memberCount: number;
  pendingName: string | null;
};

export type OrganizationApprovalView = {
  id: string;
  kind: string;
  status: string;
  requestedRole: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  requester: { id: string; email: string; name: string | null };
  member: { id: string; userId: string; email: string; name: string | null } | null;
};

export type OrganizationApprovalAction = 'approve' | 'reject';

export type OrganizationProfileInput = {
  name: unknown;
};

export type OrganizationCreationSetting = {
  enabled: boolean;
  updatedAt: Date | null;
};

export type OrganizationCreationGrantView = {
  userId: string;
  email: string;
  name: string | null;
  grantedAt: Date;
  grantedBy: { id: string; email: string; name: string | null } | null;
};

export type OrganizationCreationCandidate = {
  id: string;
  email: string;
  name: string | null;
};

const FALLBACK_PENDING_INVITATION_ROLE: OrganizationRoleKey = 'researcher';

const membershipInclude = {
  organization: {
    select: { id: true, name: true, status: true, ownerUserId: true },
  },
  roleAssignments: {
    include: {
      role: { select: { key: true, name: true, permissions: true } },
    },
  },
  permissionOverrides: {
    select: { permission: true, granted: true },
  },
} as const;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P2002';
}

function parseApprovalPayload(payload: string): { roleKey: OrganizationRoleKey | null } {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== 'object' || parsed === null || !('roleKey' in parsed)) {
      return { roleKey: null };
    }
    const roleKey = parsed.roleKey;
    return isOrganizationRoleKey(roleKey) ? { roleKey } : { roleKey: null };
  } catch {
    return { roleKey: null };
  }
}

function rolePermissions(membership: OrganizationMembership): Set<string> {
  const permissions = new Set(membership.roleAssignments.flatMap(({ role }) => parseOrganizationPermissions(role.permissions)));
  for (const override of membership.permissionOverrides ?? []) {
    if (override.granted) permissions.add(override.permission);
    else permissions.delete(override.permission);
  }
  return permissions;
}

function effectivePermissionsForMember(member: {
  roleAssignments: Array<{ role: OrganizationRoleView }>;
  permissionOverrides?: Array<{ permission: string; granted: boolean }>;
}): string[] {
  const permissions = new Set(member.roleAssignments.flatMap(({ role }) => parseOrganizationPermissions(role.permissions)));
  for (const override of member.permissionOverrides ?? []) {
    if (override.granted) permissions.add(override.permission);
    else permissions.delete(override.permission);
  }
  return Array.from(permissions);
}

export function hasOrganizationPermission(
  membership: OrganizationMembership,
  permission: OrganizationPermission,
): boolean {
  return rolePermissions(membership).has(permission);
}

export async function requireOrganizationPermission(
  userId: string,
  organizationId: string,
  permission: OrganizationPermission,
): Promise<OrganizationMembership> {
  const membership = await getOrganizationMembership(userId, organizationId);
  if (!membership) throw new OrganizationRbacError('MEMBERSHIP_NOT_FOUND', '组织成员关系不存在');
  if (['pending', 'pending_reapproval'].includes(membership.organization.status)) {
    if (permission !== 'organization.read' || membership.organization.ownerUserId !== userId) {
      throw new OrganizationRbacError('ORGANIZATION_PENDING_APPROVAL', '组织正在等待平台管理员审核');
    }
    return membership;
  }
  if (!hasOrganizationPermission(membership, permission)) {
    throw new OrganizationRbacError('PERMISSION_DENIED', '组织权限不足');
  }
  return membership;
}

export async function requireOrganizationMemberManager(userId: string, organizationId: string): Promise<OrganizationMembership> {
  const membership = await requireOrganizationPermission(userId, organizationId, 'organization.members.read');
  const isOwner = membership.organization.ownerUserId === userId;
  const isAdmin = membership.roleAssignments.some(({ role }) => role.key === 'admin');
  if (!isOwner && !isAdmin) {
    throw new OrganizationRbacError('PERMISSION_DENIED', '只有组织所有者和审计员可以使用成员管理');
  }
  return membership;
}

export function organizationRbacErrorStatus(error: unknown): number {
  if (!(error instanceof OrganizationRbacError)) return 500;
  if (error.code === 'ORGANIZATION_NOT_FOUND' || error.code === 'ORGANIZATION_REJECTED' || error.code === 'MEMBERSHIP_NOT_FOUND' || error.code === 'MEMBERSHIP_NOT_ACTIVE' || error.code === 'USER_NOT_FOUND' || error.code === 'TARGET_MEMBER_NOT_FOUND' || error.code === 'APPROVAL_NOT_FOUND' || error.code === 'INVITATION_NOT_FOUND') return 404;
  if (error.code === 'PERMISSION_DENIED' || error.code === 'SELF_INVITE' || error.code === 'OWNER_ROLE_CHANGE_FORBIDDEN' || error.code === 'OWNER_ONLY_ROLE_MANAGEMENT' || error.code === 'OWNER_CANNOT_LEAVE' || error.code === 'SELF_APPROVAL' || error.code === 'ORGANIZATION_DELETE_FORBIDDEN' || error.code === 'ORGANIZATION_CREATION_DISABLED') return 403;
  if (error.code === 'MEMBER_EXISTS' || error.code === 'PENDING_MEMBER' || error.code === 'ROLE_UNCHANGED' || error.code === 'ORGANIZATION_PROFILE_UNCHANGED' || error.code === 'PENDING_APPROVAL_EXISTS' || error.code === 'APPROVAL_ALREADY_REVIEWED') return 409;
  if (error.code === 'ORGANIZATION_PENDING_APPROVAL') return 409;
  return 400;
}

export async function getOrganizationCreationSetting(): Promise<OrganizationCreationSetting> {
  const setting = await prisma.systemSettings.findUnique({
    where: { id: 1 },
    select: { organizationCreationEnabled: true, updatedAt: true },
  });
  return {
    enabled: setting?.organizationCreationEnabled ?? false,
    updatedAt: setting?.updatedAt ?? null,
  };
}

export async function setOrganizationCreationEnabled(
  enabled: boolean,
): Promise<OrganizationCreationSetting> {
  const setting = await prisma.systemSettings.upsert({
    where: { id: 1 },
    create: { id: 1, organizationCreationEnabled: enabled },
    update: { organizationCreationEnabled: enabled },
    select: { organizationCreationEnabled: true, updatedAt: true },
  });
  return {
    enabled: setting.organizationCreationEnabled,
    updatedAt: setting.updatedAt,
  };
}

export async function canUserCreateOrganization(userId: string): Promise<boolean> {
  const grant = await prisma.organizationCreationGrant.findUnique({
    where: { userId },
    select: { userId: true },
  });
  return Boolean(grant);
}

export async function listOrganizationCreationAccess(search = ''): Promise<{
  grants: OrganizationCreationGrantView[];
  candidates: OrganizationCreationCandidate[];
}> {
  const normalizedSearch = search.trim();
  const [grants, candidates] = await Promise.all([
    prisma.organizationCreationGrant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        userId: true,
        createdAt: true,
        user: { select: { email: true, name: true } },
        grantedBy: { select: { id: true, email: true, name: true } },
      },
    }),
    normalizedSearch.length < 2
      ? Promise.resolve([] as OrganizationCreationCandidate[])
      : prisma.user.findMany({
          where: {
            OR: [
              { email: { contains: normalizedSearch } },
              { name: { contains: normalizedSearch } },
              { id: { contains: normalizedSearch } },
            ],
          },
          orderBy: { email: 'asc' },
          take: 20,
          select: { id: true, email: true, name: true },
        }),
  ]);

  return {
    grants: grants.map((grant) => ({
      userId: grant.userId,
      email: grant.user.email,
      name: grant.user.name,
      grantedAt: grant.createdAt,
      grantedBy: grant.grantedBy,
    })),
    candidates,
  };
}

export async function setOrganizationCreationGrant(
  targetUserId: string,
  grantedByUserId: string,
  allowed: boolean,
) {
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
  if (!target) throw new OrganizationRbacError('USER_NOT_FOUND', '指定用户不存在');

  if (allowed) {
    return prisma.organizationCreationGrant.upsert({
      where: { userId: targetUserId },
      create: { userId: targetUserId, grantedByUserId },
      update: { grantedByUserId },
      select: { userId: true, createdAt: true },
    });
  }

  await prisma.organizationCreationGrant.deleteMany({ where: { userId: targetUserId } });
  return { userId: targetUserId, revoked: true };
}

export async function getOrganizationMembership(
  userId: string,
  organizationId: string,
): Promise<OrganizationMembership | null> {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: membershipInclude,
  });
  if (!membership || membership.status !== 'active' || !['active', 'pending', 'pending_reapproval'].includes(membership.organization.status)) return null;
  return membership;
}

export async function listOrganizationsForUser(userId: string) {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId, status: 'active', organization: { status: { in: ['active', 'pending', 'pending_reapproval', 'rejected'] } } },
    orderBy: { organization: { name: 'asc' } },
    include: membershipInclude,
  });

  return memberships.map((membership) => ({
    id: membership.organization.id,
    name: membership.organization.name,
    status: membership.organization.status,
    ownerUserId: membership.organization.ownerUserId,
    membershipId: membership.id,
    roles: membership.roleAssignments.map(({ role }) => ({ key: role.key, name: role.name })),
    permissions: Array.from(rolePermissions(membership)),
  }));
}

export async function listOrganizationsPendingApproval(): Promise<OrganizationAdminView[]> {
  const organizations = await prisma.organization.findMany({
    where: { status: { in: ['pending', 'pending_reapproval'] } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      status: true,
      ownerUserId: true,
      pendingName: true,
      createdAt: true,
      owner: { select: { id: true, email: true, name: true } },
      _count: { select: { members: true } },
    },
  });

  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    status: organization.status,
    ownerUserId: organization.ownerUserId,
    owner: organization.owner,
    createdAt: organization.createdAt,
    memberCount: organization._count.members,
    pendingName: organization.pendingName,
  }));
}

/**
 * Backfill approval notifications for pending organizations created before
 * the notification write was added, while keeping concurrent refreshes idempotent.
 */
export async function ensurePendingOrganizationApprovalNotifications(): Promise<void> {
  const organizations = await prisma.organization.findMany({
    where: { status: { in: ['pending', 'pending_reapproval'] } },
    select: { id: true, name: true, pendingName: true, status: true },
  });
  if (organizations.length === 0) return;

  const existing = await prisma.notification.findMany({
    where: {
      role: 'admin',
      type: { in: ['organization_approval_requested', 'organization_profile_approval_requested'] },
      deletedAt: null,
    },
    select: { type: true, metadata: true },
  });
  const existingKeys = new Set(
    existing.flatMap((notification) => {
      if (!notification.metadata) return [];
      try {
        const metadata = JSON.parse(notification.metadata) as { organizationId?: unknown };
        return typeof metadata.organizationId === 'string'
          ? [`${notification.type}:${metadata.organizationId}`]
          : [];
      } catch {
        return [];
      }
    }),
  );

  for (const organization of organizations) {
    const isReapproval = organization.status === 'pending_reapproval';
    const type = isReapproval ? 'organization_profile_approval_requested' : 'organization_approval_requested';
    const key = `${type}:${organization.id}`;
    if (existingKeys.has(key)) continue;

    const metadata = JSON.stringify({
      organizationId: organization.id,
      status: organization.status,
      ...(isReapproval && organization.pendingName ? { pendingName: organization.pendingName } : {}),
    });
    await prisma.notification.upsert({
      where: { id: `organization-approval-${isReapproval ? 'reapproval' : 'creation'}-${organization.id}` },
      create: {
        id: `organization-approval-${isReapproval ? 'reapproval' : 'creation'}-${organization.id}`,
        email: 'admin',
        role: 'admin',
        type,
        title: isReapproval ? '组织名称修改审核申请' : '新的组织审核申请',
        content: isReapproval
          ? `组织“${organization.name}”申请修改名称，请前往组织审核处理。`
          : `组织“${organization.name}”已提交创建申请，请前往组织审核处理。`,
        linkUrl: '/admin/organizations',
        metadata,
      },
      update: {},
    });
    existingKeys.add(key);
  }
}

export type OrganizationCreationReviewAction = 'approve' | 'reject';

export async function reviewOrganizationCreation(
  reviewerUserId: string,
  organizationId: string,
  action: OrganizationCreationReviewAction,
) {
  if (action !== 'approve' && action !== 'reject') {
    throw new OrganizationRbacError('INVALID_APPROVAL', '审核动作无效');
  }

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, pendingName: true, status: true, ownerUserId: true, owner: { select: { email: true } } },
    });
    if (!organization) throw new OrganizationRbacError('ORGANIZATION_NOT_FOUND', '组织不存在');
    if (!['pending', 'pending_reapproval'].includes(organization.status)) {
      throw new OrganizationRbacError('APPROVAL_ALREADY_REVIEWED', '组织审核已经处理');
    }

    const isReapproval = organization.status === 'pending_reapproval';
    const reviewedStatus = isReapproval || action === 'approve' ? 'active' : 'rejected';
    const updated = await tx.organization.updateMany({
      where: { id: organizationId, status: organization.status },
      data: isReapproval
        ? {
            ...(action === 'approve' && organization.pendingName ? { name: organization.pendingName } : {}),
            pendingName: null,
            status: reviewedStatus,
          }
        : { status: reviewedStatus },
    });
    if (updated.count !== 1) {
      throw new OrganizationRbacError('APPROVAL_ALREADY_REVIEWED', '组织审核已经处理');
    }
    await tx.securityEvent.create({
      data: {
        userId: reviewerUserId,
        eventType: isReapproval
          ? (action === 'approve' ? 'ORGANIZATION_PROFILE_UPDATED' : 'ORGANIZATION_PROFILE_CHANGE_REJECTED')
          : (action === 'approve' ? 'ORGANIZATION_ACTIVATED' : 'ORGANIZATION_REJECTED'),
        metadata: JSON.stringify({ organizationId, action, status: reviewedStatus }),
      },
    });
    const isReapprovalApproved = isReapproval && action === 'approve';
    await tx.notification.create({
      data: {
        userId: organization.ownerUserId,
        email: organization.owner?.email || '',
        role: 'customer',
        type: 'organization_approval_result',
        title: isReapproval ? '组织名称审核结果' : '组织创建审核结果',
        content: isReapproval
          ? (isReapprovalApproved ? `组织“${organization.name}”的名称修改已通过平台审核。` : `组织“${organization.name}”的名称修改未通过平台审核，原名称保持不变。`)
          : (action === 'approve' ? `组织“${organization.name}”已通过平台审核，可以开始使用。` : `组织“${organization.name}”未通过平台审核，可以删除后重新提交申请。`),
        linkUrl: '/account/organizations',
        metadata: JSON.stringify({ organizationId, action, status: reviewedStatus }),
      },
    });
    return { organizationId, status: reviewedStatus };
  });
}

export async function updateOrganizationProfile(
  userId: string,
  organizationId: string,
  input: OrganizationProfileInput,
) {
  if (typeof input.name !== 'string') {
    throw new OrganizationRbacError('INVALID_NAME', '组织名称长度必须为 2 到 100 个字符');
  }
  const name = input.name.trim();
  if (name.length < 2 || name.length > 100) {
    throw new OrganizationRbacError('INVALID_NAME', '组织名称长度必须为 2 到 100 个字符');
  }

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, ownerUserId: true, status: true, pendingName: true },
    });
    if (!organization) throw new OrganizationRbacError('ORGANIZATION_NOT_FOUND', '组织不存在');
    if (organization.ownerUserId !== userId) {
      throw new OrganizationRbacError('PERMISSION_DENIED', '只有组织所有者可以修改组织资料');
    }
    if (organization.status !== 'active') {
      if (organization.status === 'pending' || organization.status === 'pending_reapproval') {
        throw new OrganizationRbacError('ORGANIZATION_PENDING_APPROVAL', '组织正在等待平台管理员审核');
      }
      throw new OrganizationRbacError('ORGANIZATION_REJECTED', '组织当前不可修改');
    }
    if (name === organization.name) {
      throw new OrganizationRbacError('ORGANIZATION_PROFILE_UNCHANGED', '组织名称没有变化');
    }

    const updated = await tx.organization.update({
      where: { id: organizationId },
      data: { pendingName: name, status: 'pending_reapproval' },
      select: { id: true, name: true, pendingName: true, status: true },
    });
    await tx.securityEvent.create({
      data: {
        userId,
        eventType: 'ORGANIZATION_PROFILE_CHANGE_REQUESTED',
        metadata: JSON.stringify({ organizationId, oldName: organization.name, newName: name, status: updated.status }),
      },
    });
    await tx.notification.create({
      data: {
        email: 'admin',
        role: 'admin',
        type: 'organization_profile_approval_requested',
        title: '组织名称修改审核申请',
        content: `组织“${organization.name}”申请修改为“${name}”，请前往组织审核处理。`,
        linkUrl: '/admin/organizations',
        metadata: JSON.stringify({ organizationId, oldName: organization.name, newName: name, status: updated.status }),
      },
    });
    return updated;
  });
}

export async function deleteRejectedOrganization(userId: string, organizationId: string) {
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, ownerUserId: true, status: true, _count: { select: { orders: true, inquiries: true } } },
    });
    if (!organization) throw new OrganizationRbacError('ORGANIZATION_NOT_FOUND', '组织不存在');
    if (organization.ownerUserId !== userId) {
      throw new OrganizationRbacError('PERMISSION_DENIED', '只有组织所有者可以删除组织');
    }
    if (organization.status !== 'rejected') {
      throw new OrganizationRbacError('ORGANIZATION_DELETE_FORBIDDEN', '只有审核未通过的组织可以删除');
    }
    if ((organization._count?.orders ?? 0) > 0 || (organization._count?.inquiries ?? 0) > 0) {
      throw new OrganizationRbacError('ORGANIZATION_DELETE_FORBIDDEN', '组织存在业务记录，无法删除');
    }

    await tx.securityEvent.create({
      data: {
        userId,
        eventType: 'ORGANIZATION_DELETED',
        metadata: JSON.stringify({ organizationId, name: organization.name, status: organization.status }),
      },
    });
    await tx.organization.delete({ where: { id: organizationId } });
    return { organizationId, status: 'deleted' };
  });
}

export async function listOrganizationIdsForPermission(
  userId: string,
  permission: OrganizationPermission,
): Promise<string[]> {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId, status: 'active', organization: { status: 'active' } },
    include: membershipInclude,
  });
  return memberships
    .filter((membership) => hasOrganizationPermission(membership, permission))
    .map((membership) => membership.organizationId);
}

export async function listActiveOrganizationIdsForUser(userId: string): Promise<string[]> {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId, status: 'active', organization: { status: 'active' } },
    select: { organizationId: true },
  });
  return memberships.map((membership) => membership.organizationId);
}

export async function listOrganizationInvitationsForUser(userId: string): Promise<OrganizationInvitationView[]> {
  const invitations = await prisma.organizationMember.findMany({
    where: { userId, status: 'pending', organization: { status: 'active' } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      organizationId: true,
      pendingRoleKey: true,
      createdAt: true,
      organization: { select: { name: true } },
    },
  });

  return invitations.map((invitation) => ({
    id: invitation.id,
    organizationId: invitation.organizationId,
    organizationName: invitation.organization.name,
    requestedRole: invitation.pendingRoleKey || FALLBACK_PENDING_INVITATION_ROLE,
    invitedAt: invitation.createdAt,
  }));
}

export async function createOrganization(userId: string, name: string) {
  if (!(await canUserCreateOrganization(userId))) {
    throw new OrganizationRbacError('ORGANIZATION_CREATION_DISABLED', '当前账户尚未获得组织创建权限');
  }
  const normalizedName = name.trim();
  if (normalizedName.length < 2 || normalizedName.length > 100) {
    throw new OrganizationRbacError('INVALID_NAME', '组织名称长度必须为 2 到 100 个字符');
  }

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: normalizedName, ownerUserId: userId, status: 'pending' },
    });
    const roles = new Map<OrganizationRoleKey, { id: string }>();
    const definitions = Object.entries(ORGANIZATION_ROLE_DEFINITIONS) as Array<[
      OrganizationRoleKey,
      (typeof ORGANIZATION_ROLE_DEFINITIONS)[OrganizationRoleKey],
    ]>;

    for (const [key, definition] of definitions) {
      const role = await tx.organizationRole.create({
        data: {
          organizationId: organization.id,
          key,
          name: definition.name,
          permissions: JSON.stringify(definition.permissions),
        },
        select: { id: true },
      });
      roles.set(key, role);
    }

    const member = await tx.organizationMember.create({
      data: { organizationId: organization.id, userId, status: 'active', joinedAt: new Date() },
      select: { id: true },
    });
    const ownerRole = roles.get('owner');
    if (!ownerRole) throw new OrganizationRbacError('INVALID_ROLE', '组织所有者角色未初始化');
    await tx.organizationRoleAssignment.create({
      data: { memberId: member.id, roleId: ownerRole.id, assignedBy: userId },
    });
    await tx.securityEvent.create({
      data: {
        userId,
        eventType: 'ORGANIZATION_CREATED',
        metadata: JSON.stringify({ organizationId: organization.id, status: organization.status }),
      },
    });
    await tx.notification.create({
      data: {
        email: 'admin',
        role: 'admin',
        type: 'organization_approval_requested',
        title: '新的组织审核申请',
        content: `组织“${organization.name}”已提交创建申请，请前往组织审核处理。`,
        linkUrl: '/admin/organizations',
        metadata: JSON.stringify({ organizationId: organization.id, status: organization.status }),
      },
    });
    return { id: organization.id, name: organization.name, status: organization.status };
  });
}

export async function listOrganizationMembers(organizationId: string): Promise<OrganizationMemberView[]> {
  const members = await prisma.organizationMember.findMany({
    where: { organizationId, status: { in: ['active', 'pending'] } },
    orderBy: [{ joinedAt: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      userId: true,
      status: true,
      joinedAt: true,
      createdAt: true,
      pendingRoleKey: true,
      user: { select: { email: true, name: true } },
      roleAssignments: { select: { role: { select: { key: true, name: true, permissions: true } } } },
      permissionOverrides: { select: { permission: true, granted: true } },
    },
  });

  return members.map((member) => ({
    id: member.id,
    userId: member.userId,
    email: member.user.email,
    name: member.user.name,
    status: member.status,
    joinedAt: member.joinedAt,
    createdAt: member.createdAt,
    pendingRole: member.pendingRoleKey || FALLBACK_PENDING_INVITATION_ROLE,
    roles: member.roleAssignments.map(({ role }) => ({ key: role.key, name: role.name })),
    permissions: effectivePermissionsForMember(member),
  }));
}

export async function updateOrganizationMemberPermissions(
  requesterUserId: string,
  organizationId: string,
  memberId: string,
  requestedPermissions: unknown,
) {
  if (!Array.isArray(requestedPermissions) || requestedPermissions.some((permission) => !ORGANIZATION_MEMBER_PERMISSION_KEYS.includes(permission as OrganizationPermission))) {
    throw new OrganizationRbacError('INVALID_PERMISSION', '成员权限设置无效');
  }
  const desiredPermissions = new Set(requestedPermissions as OrganizationPermission[]);

  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { ownerUserId: true, status: true },
    });
    if (!organization) throw new OrganizationRbacError('ORGANIZATION_NOT_FOUND', '组织不存在');
    if (organization.status !== 'active') {
      throw new OrganizationRbacError('ORGANIZATION_PENDING_APPROVAL', '组织正在等待平台管理员审核');
    }

    const requester = await tx.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: requesterUserId } },
      select: {
        id: true,
        status: true,
        roleAssignments: { include: { role: { select: { key: true, name: true, permissions: true } } } },
        permissionOverrides: { select: { permission: true, granted: true } },
      },
    });
    if (!requester || requester.status !== 'active') {
      throw new OrganizationRbacError('PERMISSION_DENIED', '组织成员关系不存在');
    }
    const requesterIsOwner = organization.ownerUserId === requesterUserId;
    const requesterPermissions = requesterIsOwner
      ? new Set<string>(ORGANIZATION_MEMBER_PERMISSION_KEYS)
      : new Set(effectivePermissionsForMember(requester));
    const requesterIsAdmin = requester.roleAssignments.some(({ role }) => role.key === 'admin');
    if (!requesterIsOwner && !requesterIsAdmin) {
      throw new OrganizationRbacError('PERMISSION_DENIED', '只有组织所有者和审计员可以设置成员权限');
    }

    const member = await tx.organizationMember.findFirst({
      where: { id: memberId, organizationId, status: 'active' },
      select: {
        id: true,
        userId: true,
        roleAssignments: { include: { role: { select: { key: true, name: true, permissions: true } } } },
        permissionOverrides: { select: { permission: true, granted: true } },
      },
    });
    if (!member) throw new OrganizationRbacError('TARGET_MEMBER_NOT_FOUND', '目标成员不存在');
    if (member.userId === requesterUserId) {
      throw new OrganizationRbacError('PERMISSION_DENIED', '组织所有者权限由所有者角色管理');
    }

    const targetPermissions = new Set(effectivePermissionsForMember({
      roleAssignments: member.roleAssignments,
      permissionOverrides: member.permissionOverrides,
    }));
    if (!requesterIsOwner) {
      for (const permission of targetPermissions) {
        if (!requesterPermissions.has(permission)) {
          throw new OrganizationRbacError('PERMISSION_DENIED', '只能调整权限范围不高于当前成员的下级成员');
        }
      }
    }
    for (const permission of ORGANIZATION_MEMBER_PERMISSION_KEYS) {
      if (targetPermissions.has(permission) !== desiredPermissions.has(permission) && !requesterPermissions.has(permission)) {
        throw new OrganizationRbacError('PERMISSION_DENIED', '不能授予当前成员没有的权限');
      }
    }

    const inheritedPermissions = new Set(member.roleAssignments.flatMap(({ role }) => parseOrganizationPermissions(role.permissions)));
    for (const permission of ORGANIZATION_MEMBER_PERMISSION_KEYS) {
      const shouldGrant = desiredPermissions.has(permission);
      const inherited = inheritedPermissions.has(permission);
      if (shouldGrant === inherited) {
        await tx.organizationMemberPermission.deleteMany({ where: { memberId, permission } });
      } else {
        await tx.organizationMemberPermission.upsert({
          where: { memberId_permission: { memberId, permission } },
          create: { memberId, permission, granted: shouldGrant, assignedBy: requesterUserId },
          update: { granted: shouldGrant, assignedBy: requesterUserId },
        });
      }
    }

    const updatedOverrides = await tx.organizationMemberPermission.findMany({
      where: { memberId },
      select: { permission: true, granted: true },
    });
    const updatedMember = {
      roleAssignments: member.roleAssignments,
      permissionOverrides: updatedOverrides,
    };
    await tx.securityEvent.create({
      data: {
        userId: requesterUserId,
        eventType: 'ORGANIZATION_MEMBER_PERMISSIONS_UPDATED',
        metadata: JSON.stringify({ organizationId, memberId, permissions: effectivePermissionsForMember(updatedMember) }),
      },
    });
    return { memberId, permissions: effectivePermissionsForMember(updatedMember) };
  });
}

export async function inviteOrganizationMember(
  requesterUserId: string,
  organizationId: string,
  email: string,
  roleKey: unknown,
) {
  if (!isInvitableOrganizationRole(roleKey)) {
    throw new OrganizationRbacError('INVALID_ROLE', '成员角色无效');
  }
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new OrganizationRbacError('INVALID_EMAIL', '邮箱格式无效');
  }
  const invitee = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true, name: true },
  });
  if (!invitee) throw new OrganizationRbacError('USER_NOT_FOUND', '用户不存在');
  if (invitee.id === requesterUserId) throw new OrganizationRbacError('SELF_INVITE', '不能邀请当前账户');

  try {
    return await prisma.$transaction(async (tx) => {
      const requester = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: requesterUserId } },
        select: {
          status: true,
          organization: { select: { name: true, ownerUserId: true, status: true } },
          roleAssignments: { include: { role: { select: { key: true, name: true, permissions: true } } } },
          permissionOverrides: { select: { permission: true, granted: true } },
        },
      });
      if (!requester || requester.status !== 'active') {
        throw new OrganizationRbacError('PERMISSION_DENIED', '组织成员关系不存在');
      }
      if (['pending', 'pending_reapproval'].includes(requester.organization.status)) {
        throw new OrganizationRbacError('ORGANIZATION_PENDING_APPROVAL', '组织正在等待平台管理员审核');
      }
      const isOwner = requester.organization.ownerUserId === requesterUserId;
      const isAdmin = requester.roleAssignments.some(({ role }) => role.key === 'admin');
      if (!isOwner && !isAdmin) {
        throw new OrganizationRbacError('PERMISSION_DENIED', '只有组织所有者和审计员可以邀请成员');
      }
      if (!isOwner && roleKey === 'admin') {
        throw new OrganizationRbacError('OWNER_ONLY_ROLE_MANAGEMENT', '只有组织所有者可以授予或撤销管理员角色');
      }

      const existing = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: invitee.id } },
        select: { id: true, status: true },
      });
      if (existing?.status === 'active') throw new OrganizationRbacError('MEMBER_EXISTS', '成员已经加入组织');
      if (existing?.status === 'pending') throw new OrganizationRbacError('PENDING_MEMBER', '成员邀请已经提交');

      const member = existing
        ? await tx.organizationMember.update({
            where: { id: existing.id },
            data: { status: 'pending', joinedAt: null, pendingRoleKey: roleKey },
            select: { id: true },
          })
        : await tx.organizationMember.create({
            data: { organizationId, userId: invitee.id, status: 'pending', pendingRoleKey: roleKey },
            select: { id: true },
          });

      if (existing) {
        await tx.organizationRoleAssignment.deleteMany({ where: { memberId: existing.id } });
      }
      await tx.securityEvent.create({
        data: {
          userId: requesterUserId,
          eventType: 'ORGANIZATION_MEMBER_INVITED',
          metadata: JSON.stringify({ organizationId, memberId: member.id, roleKey }),
        },
      });
      await tx.notification.create({
        data: {
          userId: invitee.id,
          email: invitee.email,
          role: 'customer',
          type: 'organization_invitation',
          title: '新的组织邀请',
          content: `${requester.organization.name} 邀请加入组织，确认后加入。`,
          linkUrl: '/account/organizations',
          metadata: JSON.stringify({ organizationId, memberId: member.id, roleKey }),
        },
      });
      return {
        id: member.id,
        kind: 'member_invite',
        status: 'pending',
        memberId: member.id,
        email: invitee.email,
        roleKey,
        requiresAcceptance: true,
      };
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new OrganizationRbacError('MEMBER_EXISTS', '成员邀请状态已改变，请刷新后重试');
    }
    throw error;
  }
}

export async function acceptOrganizationInvitation(userId: string, organizationId: string) {
  return prisma.$transaction(async (tx) => {
    const membership = await tx.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: {
        id: true,
        status: true,
        pendingRoleKey: true,
        organization: { select: { id: true, name: true, status: true } },
      },
    });
    if (!membership || membership.status !== 'pending') {
      throw new OrganizationRbacError('INVITATION_NOT_FOUND', '待确认的组织邀请不存在');
    }
    if (['pending', 'pending_reapproval'].includes(membership.organization.status)) {
      throw new OrganizationRbacError('ORGANIZATION_PENDING_APPROVAL', '组织正在等待平台管理员审核');
    }
    if (membership.organization.status !== 'active') {
      throw new OrganizationRbacError('ORGANIZATION_REJECTED', '组织当前不可加入');
    }
    const roleKey = isInvitableOrganizationRole(membership.pendingRoleKey)
      ? membership.pendingRoleKey
      : FALLBACK_PENDING_INVITATION_ROLE;

    const role = await tx.organizationRole.findUnique({
      where: { organizationId_key: { organizationId, key: roleKey } },
      select: { id: true },
    });
    if (!role) throw new OrganizationRbacError('INVALID_ROLE', '组织角色不存在');

    await tx.organizationMember.update({
      where: { id: membership.id },
      data: { status: 'active', joinedAt: new Date(), pendingRoleKey: null },
    });
    await tx.organizationRoleAssignment.deleteMany({ where: { memberId: membership.id } });
    await tx.organizationRoleAssignment.create({
      data: { memberId: membership.id, roleId: role.id, assignedBy: userId },
    });
    await tx.securityEvent.create({
      data: {
        userId,
        eventType: 'ORGANIZATION_INVITATION_ACCEPTED',
        metadata: JSON.stringify({ organizationId, memberId: membership.id, roleKey }),
      },
    });
    return {
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      roleKey,
      status: 'active',
    };
  });
}

export async function leaveOrganization(userId: string, organizationId: string) {
  const transaction = await prisma.$transaction(async (tx) => {
    const membership = await tx.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: {
        id: true,
        status: true,
        organization: { select: { id: true, ownerUserId: true, status: true, owner: { select: { email: true } } } },
      },
    });
    if (!membership || !['active', 'pending'].includes(membership.status)) {
      throw new OrganizationRbacError('MEMBERSHIP_NOT_ACTIVE', '当前账户不在该组织中');
    }
    if (membership.organization.ownerUserId === userId) {
      throw new OrganizationRbacError('OWNER_CANNOT_LEAVE', '组织所有者不能退出组织，当前组织未提供所有权转移或关闭功能');
    }

    const isMemberExit = membership.status === 'active';
    if (isMemberExit) {
      const pendingExit = await tx.organizationApprovalRequest.findFirst({
        where: { organizationId, memberId: membership.id, kind: 'member_exit', status: 'pending' },
        select: { id: true },
      });
      if (pendingExit) throw new OrganizationRbacError('PENDING_APPROVAL_EXISTS', '退出申请已经提交，请等待组织所有者审核');

      const approval = await tx.organizationApprovalRequest.create({
        data: {
          organizationId,
          memberId: membership.id,
          requesterUserId: userId,
          kind: 'member_exit',
          payload: JSON.stringify({ reason: 'member_requested_exit' }),
        },
        select: { id: true },
      });
      await tx.securityEvent.create({
        data: {
          userId,
          eventType: 'ORGANIZATION_MEMBER_EXIT_REQUESTED',
          metadata: JSON.stringify({ organizationId, memberId: membership.id, approvalId: approval.id }),
        },
      });
      await tx.notification.create({
        data: {
          userId: membership.organization.ownerUserId,
          email: membership.organization.owner.email,
          role: 'customer',
          type: 'organization_member_exit_requested',
          title: '成员退出申请待审核',
          content: '组织成员提交了退出申请，请在组织管理中审核。',
          linkUrl: '/account/organizations',
          metadata: JSON.stringify({ organizationId, memberId: membership.id, approvalId: approval.id }),
        },
      });
      return {
        result: { organizationId, status: 'pending_exit' as const, approvalId: approval.id },
        pendingExitOwner: {
          email: membership.organization.owner.email,
          organizationId,
          approvalId: approval.id,
        },
      };
    }

    await tx.organizationMember.update({
      where: { id: membership.id },
      data: { status: 'removed', joinedAt: null, pendingRoleKey: null },
    });
    await tx.organizationRoleAssignment.deleteMany({ where: { memberId: membership.id } });
    await tx.securityEvent.create({
      data: {
        userId,
        eventType: isMemberExit ? 'ORGANIZATION_MEMBER_LEFT' : 'ORGANIZATION_INVITATION_DECLINED',
        metadata: JSON.stringify({
          organizationId,
          memberId: membership.id,
          ...(isMemberExit
            ? {
                ownershipPolicy: 'organization_records_retained_personal_assets_retained',
                personalAssets: 'retained_with_user',
                organizationRecords: 'retained_with_organization',
                accessRevoked: true,
              }
            : { invitationDeclined: true }),
        }),
      },
    });
    return { result: { organizationId, status: 'removed' as const }, pendingExitOwner: null };
  });

  if (transaction.pendingExitOwner) {
    sendOrganizationNotificationEmail({
      to: transaction.pendingExitOwner.email,
      subject: 'LIBEREAL · 成员退出申请待审核',
      message: '组织成员提交了退出申请，请进入组织管理完成审核。',
      path: `/account/organizations?organizationId=${encodeURIComponent(transaction.pendingExitOwner.organizationId)}&approvalId=${encodeURIComponent(transaction.pendingExitOwner.approvalId)}`,
    });
  }
  return transaction.result;
}

export async function requestOrganizationRoleChange(
  requesterUserId: string,
  organizationId: string,
  memberId: string,
  roleKey: unknown,
) {
  if (!isInvitableOrganizationRole(roleKey)) {
    throw new OrganizationRbacError('INVALID_ROLE', '成员角色无效');
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const requester = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: requesterUserId } },
        select: {
          status: true,
          organization: { select: { ownerUserId: true, status: true } },
          roleAssignments: { select: { role: { select: { key: true } } } },
        },
      });
      if (!requester || requester.status !== 'active') {
        throw new OrganizationRbacError('PERMISSION_DENIED', '组织成员关系不存在');
      }
      if (['pending', 'pending_reapproval'].includes(requester.organization.status)) {
        throw new OrganizationRbacError('ORGANIZATION_PENDING_APPROVAL', '组织正在等待平台管理员审核');
      }
      const requesterIsOwner = requester.organization.ownerUserId === requesterUserId;
      const requesterIsAdmin = requester.roleAssignments.some(({ role }) => role.key === 'admin');
      if (!requesterIsOwner && !requesterIsAdmin) {
        throw new OrganizationRbacError('PERMISSION_DENIED', '组织权限不足');
      }

      const member = await tx.organizationMember.findFirst({
        where: { id: memberId, organizationId, status: 'active' },
        select: {
          id: true,
          userId: true,
          organization: { select: { ownerUserId: true } },
          roleAssignments: { select: { role: { select: { key: true } } } },
        },
      });
      if (!member) throw new OrganizationRbacError('TARGET_MEMBER_NOT_FOUND', '目标成员不存在');
      if (member.userId === member.organization.ownerUserId) {
        throw new OrganizationRbacError('OWNER_ROLE_CHANGE_FORBIDDEN', '组织所有者角色不可修改');
      }
      if (member.roleAssignments?.[0]?.role.key === roleKey) {
        throw new OrganizationRbacError('ROLE_UNCHANGED', '成员当前已经是该角色');
      }

      if (!requesterIsOwner && roleKey === 'admin') {
        throw new OrganizationRbacError('OWNER_ONLY_ROLE_MANAGEMENT', '只有组织所有者可以授予或撤销管理员角色');
      }
      const targetIsAdmin = member.roleAssignments.some(({ role }) => role.key === 'admin');
      if (!requesterIsOwner && targetIsAdmin) {
        throw new OrganizationRbacError('OWNER_ONLY_ROLE_MANAGEMENT', '只有组织所有者可以授予或撤销管理员角色');
      }

      if (requesterIsOwner) {
        const role = await tx.organizationRole.findUnique({
          where: { organizationId_key: { organizationId, key: roleKey } },
          select: { id: true },
        });
        if (!role) throw new OrganizationRbacError('INVALID_ROLE', '组织角色不存在');
        await tx.organizationMember.update({
          where: { id: member.id },
          data: { status: 'active', pendingRoleKey: null },
        });
        await tx.organizationMemberPermission.deleteMany({ where: { memberId: member.id } });
        await tx.organizationRoleAssignment.deleteMany({ where: { memberId: member.id } });
        await tx.organizationRoleAssignment.create({
          data: { memberId: member.id, roleId: role.id, assignedBy: requesterUserId },
        });
        await tx.securityEvent.create({
          data: {
            userId: requesterUserId,
            eventType: 'ORGANIZATION_ROLE_CHANGED',
            metadata: JSON.stringify({ organizationId, memberId, roleKey }),
          },
        });
        return { id: member.id, memberId, roleKey, status: 'active', applied: true };
      }

      const pendingApproval = await tx.organizationApprovalRequest.findFirst({
        where: { organizationId, memberId, kind: 'role_change', status: 'pending' },
        select: { id: true },
      });
      if (pendingApproval) throw new OrganizationRbacError('PENDING_APPROVAL_EXISTS', '待审核角色变更已经存在');

      const approval = await tx.organizationApprovalRequest.create({
        data: {
          organizationId,
          memberId,
          requesterUserId,
          kind: 'role_change',
          payload: JSON.stringify({ roleKey }),
        },
        select: { id: true, kind: true, status: true, createdAt: true },
      });
      await tx.securityEvent.create({
        data: {
          userId: requesterUserId,
          eventType: 'ORGANIZATION_ROLE_CHANGE_REQUESTED',
          metadata: JSON.stringify({ organizationId, memberId, approvalId: approval.id }),
        },
      });
      return { ...approval, memberId, roleKey };
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      throw new OrganizationRbacError('PENDING_APPROVAL_EXISTS', '待审核角色变更已经存在');
    }
    throw error;
  }
}

export async function listOrganizationApprovals(userId: string, organizationId: string): Promise<OrganizationApprovalView[]> {
  await requireOrganizationPermission(userId, organizationId, 'organization.approvals.review');
  const approvals = await prisma.organizationApprovalRequest.findMany({
    where: { organizationId, kind: { in: ['role_change', 'member_exit'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      kind: true,
      status: true,
      payload: true,
      createdAt: true,
      reviewedAt: true,
      requester: { select: { id: true, email: true, name: true } },
      member: {
        select: {
          id: true,
          userId: true,
          user: { select: { email: true, name: true } },
        },
      },
    },
  });

  return approvals.map((approval) => ({
    id: approval.id,
    kind: approval.kind,
    status: approval.status,
    requestedRole: parseApprovalPayload(approval.payload).roleKey,
    createdAt: approval.createdAt,
    reviewedAt: approval.reviewedAt,
    requester: approval.requester,
    member: approval.member
      ? { id: approval.member.id, userId: approval.member.userId, ...approval.member.user }
      : null,
  }));
}

export async function reviewOrganizationApproval(
  reviewerUserId: string,
  organizationId: string,
  approvalId: string,
  action: OrganizationApprovalAction,
) {
  if (action !== 'approve' && action !== 'reject') {
    throw new OrganizationRbacError('INVALID_APPROVAL', '审核动作无效');
  }

  return prisma.$transaction(async (tx) => {
    const approval = await tx.organizationApprovalRequest.findFirst({
      where: { id: approvalId, organizationId },
      include: {
        organization: { select: { status: true, ownerUserId: true } },
        member: {
          select: {
            id: true,
            userId: true,
            status: true,
            user: { select: { email: true, name: true } },
            roleAssignments: { select: { role: { select: { key: true } } } },
          },
        },
      },
    });
    if (!approval) throw new OrganizationRbacError('APPROVAL_NOT_FOUND', '审核请求不存在');
    if (approval.status !== 'pending') throw new OrganizationRbacError('APPROVAL_ALREADY_REVIEWED', '审核请求已经处理');
    if (approval.requesterUserId === reviewerUserId) throw new OrganizationRbacError('SELF_APPROVAL', '不能审核本人提交的请求');
    if (approval.organization.status !== 'active') throw new OrganizationRbacError('ORGANIZATION_NOT_FOUND', '组织不可用');
    const reviewer = await tx.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: reviewerUserId } },
      select: {
        status: true,
        roleAssignments: { include: { role: { select: { key: true, name: true, permissions: true } } } },
        permissionOverrides: { select: { permission: true, granted: true } },
      },
    });
    const reviewerIsOwner = approval.organization.ownerUserId === reviewerUserId;
    const reviewerPermissions = reviewerIsOwner
      ? new Set<string>(ORGANIZATION_MEMBER_PERMISSION_KEYS)
      : reviewer ? new Set(effectivePermissionsForMember(reviewer)) : new Set<string>();
    if (!reviewer || reviewer.status !== 'active' || !reviewerPermissions.has('organization.approvals.review')) {
      throw new OrganizationRbacError('PERMISSION_DENIED', '组织审批权限不足');
    }
    if (approval.kind === 'member_exit') {
      if (!reviewerIsOwner) {
        throw new OrganizationRbacError('PERMISSION_DENIED', '只有组织所有者可以审核成员退出申请');
      }
      if (!approval.member || approval.member.status !== 'active') {
        throw new OrganizationRbacError('INVALID_APPROVAL', '退出申请内容无效');
      }

      const reviewedAt = new Date();
      const updatedCount = await tx.organizationApprovalRequest.updateMany({
        where: { id: approval.id, organizationId, status: 'pending' },
        data: {
          status: action === 'approve' ? 'approved' : 'rejected',
          reviewedByUserId: reviewerUserId,
          reviewedAt,
        },
      });
      if (updatedCount.count !== 1) {
        throw new OrganizationRbacError('APPROVAL_ALREADY_REVIEWED', '审核请求已经处理');
      }

      if (action === 'approve') {
        await tx.organizationMember.update({
          where: { id: approval.member.id },
          data: { status: 'removed', joinedAt: null, pendingRoleKey: null },
        });
        await tx.organizationMemberPermission.deleteMany({ where: { memberId: approval.member.id } });
        await tx.organizationRoleAssignment.deleteMany({ where: { memberId: approval.member.id } });
      }
      await tx.securityEvent.create({
        data: {
          userId: reviewerUserId,
          eventType: action === 'approve' ? 'ORGANIZATION_MEMBER_LEFT' : 'ORGANIZATION_MEMBER_EXIT_REJECTED',
          metadata: JSON.stringify({
            organizationId,
            memberId: approval.member.id,
            approvalId: approval.id,
            accessRevoked: action === 'approve',
            ownershipPolicy: 'organization_records_retained_personal_assets_retained',
          }),
        },
      });
      await tx.notification.create({
        data: {
          userId: approval.member.userId,
          email: approval.member.user.email,
          role: 'customer',
          type: 'organization_member_exit_result',
          title: action === 'approve' ? '退出组织申请已通过' : '退出组织申请未通过',
          content: action === 'approve' ? '组织所有者已通过退出申请。' : '组织所有者未通过退出申请。',
          linkUrl: '/account/organizations',
          metadata: JSON.stringify({ organizationId, memberId: approval.member.id, approvalId: approval.id, action }),
        },
      });
      return { id: approval.id, kind: approval.kind, status: action === 'approve' ? 'approved' : 'rejected', reviewedAt };
    }

    if (approval.kind !== 'role_change') throw new OrganizationRbacError('INVALID_APPROVAL', '审核请求类型无效');

    const requestedRole = parseApprovalPayload(approval.payload).roleKey;
    if (!approval.member || !requestedRole || !isInvitableOrganizationRole(requestedRole)) {
      throw new OrganizationRbacError('INVALID_APPROVAL', '审核请求内容无效');
    }
    const targetIsAdmin = approval.member.roleAssignments.some(({ role }) => role.key === 'admin');
    if ((requestedRole === 'admin' || targetIsAdmin) && !reviewerIsOwner) {
      throw new OrganizationRbacError('OWNER_ONLY_ROLE_MANAGEMENT', '只有组织所有者可以授予或撤销管理员角色');
    }

    let approvedRoleId: string | null = null;
    if (action === 'approve') {
      const role = await tx.organizationRole.findUnique({
        where: { organizationId_key: { organizationId, key: requestedRole } },
        select: { id: true },
      });
      if (!role) throw new OrganizationRbacError('INVALID_ROLE', '组织角色不存在');
      approvedRoleId = role.id;
    }

    const reviewedAt = new Date();
    const updatedCount = await tx.organizationApprovalRequest.updateMany({
      where: { id: approval.id, organizationId, status: 'pending' },
      data: {
        status: action === 'approve' ? 'approved' : 'rejected',
        reviewedByUserId: reviewerUserId,
        reviewedAt,
      },
    });
    if (updatedCount.count !== 1) {
      throw new OrganizationRbacError('APPROVAL_ALREADY_REVIEWED', '审核请求已经处理');
    }

    if (action === 'approve') {
      await tx.organizationMember.update({
        where: { id: approval.member.id },
        data: { status: 'active', joinedAt: approval.member.status === 'active' ? undefined : new Date() },
      });
      await tx.organizationMemberPermission.deleteMany({ where: { memberId: approval.member.id } });
      await tx.organizationRoleAssignment.deleteMany({ where: { memberId: approval.member.id } });
      await tx.organizationRoleAssignment.create({
        data: { memberId: approval.member.id, roleId: approvedRoleId!, assignedBy: reviewerUserId },
      });
    }

    const updated = {
      id: approval.id,
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewedAt,
    };
    await tx.securityEvent.create({
      data: {
        userId: reviewerUserId,
        eventType: 'ORGANIZATION_APPROVAL_REVIEWED',
        metadata: JSON.stringify({ organizationId, approvalId: approval.id, action }),
      },
    });
    return updated;
  });
}
