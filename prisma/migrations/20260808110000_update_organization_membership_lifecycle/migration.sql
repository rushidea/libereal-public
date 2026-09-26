ALTER TABLE "organization_members"
ADD COLUMN "pending_role_key" TEXT;

INSERT OR IGNORE INTO "AdminPermission" ("id", "key", "resource", "action", "name") VALUES
  ('perm_organizations_read', 'organizations.read', 'organizations', 'read', '查看组织审核'),
  ('perm_organizations_write', 'organizations.write', 'organizations', 'write', '审核组织创建');

INSERT OR IGNORE INTO "AdminRolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "AdminRole" AS role
JOIN "AdminPermission" AS permission
  ON permission."key" IN ('organizations.read', 'organizations.write')
WHERE role."key" = 'super_admin';
