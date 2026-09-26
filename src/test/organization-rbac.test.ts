import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isInvitableOrganizationRole,
  ORGANIZATION_PERMISSION_KEYS,
  ORGANIZATION_ROLE_DEFINITIONS,
  parseOrganizationPermissions,
} from '@/lib/organization-rbac';

describe('organization RBAC definitions', () => {
  it('defines the four baseline organization roles', () => {
    expect(Object.keys(ORGANIZATION_ROLE_DEFINITIONS)).toEqual([
      'owner',
      'admin',
      'researcher',
      'purchasing',
    ]);
    expect(ORGANIZATION_ROLE_DEFINITIONS.owner.permissions).toEqual([...ORGANIZATION_PERMISSION_KEYS]);
    expect(Object.fromEntries(Object.entries(ORGANIZATION_ROLE_DEFINITIONS).map(([key, definition]) => [key, definition.name]))).toEqual({
      owner: '组织所有者',
      admin: '审计员',
      researcher: '研究员',
      purchasing: '采购',
    });
    expect(ORGANIZATION_ROLE_DEFINITIONS.admin.permissions).toContain('organization.orders.review');
    expect(isInvitableOrganizationRole('owner')).toBe(false);
    expect(isInvitableOrganizationRole('researcher')).toBe(true);
  });

  it('keeps malformed permission JSON empty', () => {
    expect(parseOrganizationPermissions('{invalid')).toEqual([]);
    expect(parseOrganizationPermissions(JSON.stringify(['organization.read', 1, null]))).toEqual(['organization.read']);
  });

  it('keeps the role-permission repair migration aligned with the runtime definitions', () => {
    const migration = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260809100000_sync_organization_role_permissions/migration.sql'), 'utf8');
    for (const [key, definition] of Object.entries(ORGANIZATION_ROLE_DEFINITIONS)) {
      expect(migration).toContain(`WHERE "key" = '${key}' AND "is_system" = 1`);
      expect(migration).toContain(JSON.stringify(definition.permissions));
    }
  });
});
