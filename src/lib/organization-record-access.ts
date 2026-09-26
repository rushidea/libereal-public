import { OrganizationRbacError, listOrganizationIdsForPermission, requireOrganizationPermission } from '@/lib/organization-service';
import type { OrganizationPermission } from '@/lib/organization-rbac';

export type OrganizationRecordScope = 'personal' | 'organization';

export type RecordOwnershipFields = {
  organizationId: string | null;
  ownerScope: OrganizationRecordScope;
};

export async function resolveRecordOwnership(
  userId: string | null,
  organizationId: unknown,
  permission: OrganizationPermission,
): Promise<RecordOwnershipFields> {
  if (organizationId == null || organizationId === '') {
    return { organizationId: null, ownerScope: 'personal' };
  }
  if (typeof organizationId !== 'string' || !userId) {
    throw new OrganizationRbacError('INVALID_ORGANIZATION_CONTEXT', '组织归属信息无效');
  }
  await requireOrganizationPermission(userId, organizationId, permission);
  return { organizationId, ownerScope: 'organization' };
}

export async function canAccessOrganizationRecord(
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const readableOrganizations = await listOrganizationIdsForPermission(userId, 'organization.records.read');
  return readableOrganizations.includes(organizationId);
}

export async function getReadableOrganizationIds(userId: string): Promise<string[]> {
  return listOrganizationIdsForPermission(userId, 'organization.records.read');
}
