UPDATE "organization_members"
SET "pending_role_key" = 'viewer'
WHERE "status" = 'pending'
  AND ("pending_role_key" IS NULL OR "pending_role_key" NOT IN ('admin', 'researcher', 'purchasing', 'viewer'));

INSERT INTO "Notification" (
  "id",
  "userId",
  "email",
  "role",
  "type",
  "title",
  "content",
  "linkUrl",
  "metadata",
  "scope",
  "requiresAck",
  "createdAt"
)
SELECT
  lower(hex(randomblob(16))),
  u."id",
  u."email",
  'customer',
  'organization_invitation',
  '新的组织邀请',
  o."name" || ' 邀请加入组织，确认后加入。',
  '/account/organizations',
  json_object(
    'organizationId', om."organization_id",
    'memberId', om."id",
    'roleKey', COALESCE(om."pending_role_key", 'viewer')
  ),
  'personal',
  false,
  om."created_at"
FROM "organization_members" om
JOIN "User" u ON u."id" = om."user_id"
JOIN "organizations" o ON o."id" = om."organization_id"
WHERE om."status" = 'pending'
  AND NOT EXISTS (
    SELECT 1
    FROM "Notification" n
    WHERE n."type" = 'organization_invitation'
      AND json_extract(n."metadata", '$.memberId') = om."id"
  );
