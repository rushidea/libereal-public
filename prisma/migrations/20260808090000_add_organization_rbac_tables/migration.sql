CREATE TABLE "organizations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "owner_user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "organizations_owner_user_id_fkey"
      FOREIGN KEY ("owner_user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "joined_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "organization_members_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "organization_members_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "organization_roles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "organization_roles_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "organization_role_assignments" (
    "member_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "assigned_by" TEXT,
    "assigned_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_role_assignments_member_id_fkey"
      FOREIGN KEY ("member_id") REFERENCES "organization_members" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "organization_role_assignments_role_id_fkey"
      FOREIGN KEY ("role_id") REFERENCES "organization_roles" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "organization_role_assignments_assigned_by_fkey"
      FOREIGN KEY ("assigned_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    PRIMARY KEY ("member_id", "role_id")
);

CREATE TABLE "organization_approval_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "member_id" TEXT,
    "requester_user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "reviewed_by_user_id" TEXT,
    "reviewed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "organization_approval_requests_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "organization_approval_requests_member_id_fkey"
      FOREIGN KEY ("member_id") REFERENCES "organization_members" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "organization_approval_requests_requester_user_id_fkey"
      FOREIGN KEY ("requester_user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "organization_approval_requests_reviewed_by_user_id_fkey"
      FOREIGN KEY ("reviewed_by_user_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key"
ON "organization_members"("organization_id", "user_id");
CREATE INDEX "organization_members_user_id_status_idx"
ON "organization_members"("user_id", "status");
CREATE INDEX "organization_members_organization_id_status_idx"
ON "organization_members"("organization_id", "status");
CREATE UNIQUE INDEX "organization_roles_organization_id_key_key"
ON "organization_roles"("organization_id", "key");
CREATE INDEX "organization_roles_organization_id_is_system_idx"
ON "organization_roles"("organization_id", "is_system");
CREATE INDEX "organization_role_assignments_role_id_idx"
ON "organization_role_assignments"("role_id");
CREATE INDEX "organization_role_assignments_assigned_by_idx"
ON "organization_role_assignments"("assigned_by");
CREATE INDEX "organization_approval_requests_organization_id_status_created_at_idx"
ON "organization_approval_requests"("organization_id", "status", "created_at");
CREATE INDEX "organization_approval_requests_member_id_status_idx"
ON "organization_approval_requests"("member_id", "status");
CREATE INDEX "organization_approval_requests_requester_user_id_created_at_idx"
ON "organization_approval_requests"("requester_user_id", "created_at");
CREATE UNIQUE INDEX "organization_approval_requests_organization_id_member_id_kind_status_key"
ON "organization_approval_requests"("organization_id", "member_id", "kind", "status");
CREATE INDEX "organizations_owner_user_id_idx"
ON "organizations"("owner_user_id");
CREATE INDEX "organizations_status_updated_at_idx"
ON "organizations"("status", "updated_at");
