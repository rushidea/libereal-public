-- Replace the retired read-only organization role with the researcher role.
-- Existing role assignments remain attached to the same members.

UPDATE "organization_members"
SET "pending_role_key" = 'researcher'
WHERE "pending_role_key" = 'viewer';

UPDATE "organization_approval_requests"
SET "payload" = json_set("payload", '$.roleKey', 'researcher')
WHERE json_extract("payload", '$.roleKey') = 'viewer';

INSERT OR IGNORE INTO "organization_role_assignments" ("member_id", "role_id", "assigned_by", "assigned_at")
SELECT viewer_assignment."member_id", researcher_role."id", viewer_assignment."assigned_by", viewer_assignment."assigned_at"
FROM "organization_role_assignments" viewer_assignment
JOIN "organization_roles" viewer_role ON viewer_role."id" = viewer_assignment."role_id"
JOIN "organization_roles" researcher_role
  ON researcher_role."organization_id" = viewer_role."organization_id"
 AND researcher_role."key" = 'researcher'
WHERE viewer_role."key" = 'viewer';

DELETE FROM "organization_role_assignments"
WHERE "role_id" IN (
  SELECT "id" FROM "organization_roles" WHERE "key" = 'viewer'
);

UPDATE "organization_roles"
SET "key" = 'researcher',
    "name" = '研究人员',
    "permissions" = '["organization.read","organization.members.read","organization.inquiries.create","organization.pricing.read"]'
WHERE "key" = 'viewer'
  AND NOT EXISTS (
    SELECT 1 FROM "organization_roles" existing_researcher
    WHERE existing_researcher."organization_id" = "organization_roles"."organization_id"
      AND existing_researcher."key" = 'researcher'
  );

DELETE FROM "organization_roles"
WHERE "key" = 'viewer';
