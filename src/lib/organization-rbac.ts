export const ORGANIZATION_PERMISSION_KEYS = [
  'organization.read',
  'organization.members.read',
  'organization.members.invite',
  'organization.members.manage',
  'organization.roles.manage',
  'organization.profile.edit',
  'organization.records.read',
  'organization.approvals.read',
  'organization.approvals.review',
  'organization.settings.manage',
  'organization.orders.create',
  'organization.orders.review',
  'organization.inquiries.create',
  'organization.pricing.read',
] as const;

export type OrganizationPermission = typeof ORGANIZATION_PERMISSION_KEYS[number];
export type OrganizationRoleKey = 'owner' | 'admin' | 'researcher' | 'purchasing';

export const ORGANIZATION_MEMBER_PERMISSION_KEYS = ORGANIZATION_PERMISSION_KEYS.filter((permission) => ![
  'organization.roles.manage',
  'organization.profile.edit',
  'organization.settings.manage',
].includes(permission));

type RoleDefinition = {
  name: string;
  permissions: readonly OrganizationPermission[];
};

export const ORGANIZATION_ROLE_DEFINITIONS: Record<OrganizationRoleKey, RoleDefinition> = {
  owner: {
    name: '组织所有者',
    permissions: ORGANIZATION_PERMISSION_KEYS,
  },
  admin: {
    name: '审计员',
    permissions: [
      'organization.read',
      'organization.members.read',
      'organization.members.invite',
      'organization.members.manage',
      'organization.records.read',
      'organization.approvals.read',
      'organization.approvals.review',
      'organization.settings.manage',
      'organization.orders.review',
      'organization.pricing.read',
    ],
  },
  researcher: {
    name: '研究员',
    permissions: ['organization.read', 'organization.members.read', 'organization.inquiries.create', 'organization.pricing.read'],
  },
  purchasing: {
    name: '采购',
    permissions: ['organization.read', 'organization.members.read', 'organization.orders.create', 'organization.pricing.read'],
  },
};

export function isOrganizationRoleKey(value: unknown): value is OrganizationRoleKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ORGANIZATION_ROLE_DEFINITIONS, value);
}

export function isInvitableOrganizationRole(value: unknown): value is Exclude<OrganizationRoleKey, 'owner'> {
  return isOrganizationRoleKey(value) && value !== 'owner';
}

export function permissionsForOrganizationRole(role: OrganizationRoleKey): readonly OrganizationPermission[] {
  return ORGANIZATION_ROLE_DEFINITIONS[role].permissions;
}

export function parseOrganizationPermissions(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
