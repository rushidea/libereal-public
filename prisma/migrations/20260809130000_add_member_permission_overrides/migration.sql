CREATE TABLE "organization_member_permissions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "member_id" TEXT NOT NULL,
  "permission" TEXT NOT NULL,
  "granted" BOOLEAN NOT NULL DEFAULT 1,
  "assigned_by" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" DATETIME NOT NULL,
  CONSTRAINT "organization_member_permissions_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "organization_members" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "organization_member_permissions_assigned_by_fkey"
    FOREIGN KEY ("assigned_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "organization_member_permissions_member_id_permission_key"
  ON "organization_member_permissions" ("member_id", "permission");
CREATE INDEX "organization_member_permissions_permission_idx"
  ON "organization_member_permissions" ("permission");
CREATE INDEX "organization_member_permissions_assigned_by_idx"
  ON "organization_member_permissions" ("assigned_by");
