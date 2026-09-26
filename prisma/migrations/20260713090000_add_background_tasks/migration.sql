CREATE TABLE "BackgroundTask" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "payload" TEXT NOT NULL,
  "result" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "lastError" TEXT,
  "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" DATETIME,
  "lockedBy" TEXT,
  "completedAt" DATETIME,
  "dedupeKey" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "BackgroundTask_dedupeKey_key" ON "BackgroundTask"("dedupeKey");
CREATE INDEX "BackgroundTask_status_runAt_priority_idx" ON "BackgroundTask"("status", "runAt", "priority");
CREATE INDEX "BackgroundTask_type_status_idx" ON "BackgroundTask"("type", "status");
CREATE INDEX "BackgroundTask_lockedAt_idx" ON "BackgroundTask"("lockedAt");
CREATE INDEX "BackgroundTask_createdAt_idx" ON "BackgroundTask"("createdAt");

INSERT INTO "AdminPermission" ("id", "key", "resource", "action", "name") VALUES
  ('perm_tasks_read', 'tasks.read', 'tasks', 'read', '查看后台任务'),
  ('perm_tasks_manage', 'tasks.manage', 'tasks', 'manage', '管理后台任务');

INSERT INTO "AdminRolePermission" ("roleId", "permissionId")
SELECT 'role_super_admin', "id" FROM "AdminPermission" WHERE "key" IN ('tasks.read', 'tasks.manage');
INSERT INTO "AdminRolePermission" ("roleId", "permissionId")
SELECT 'role_order_admin', "id" FROM "AdminPermission" WHERE "key" = 'tasks.read';
INSERT INTO "AdminRolePermission" ("roleId", "permissionId")
SELECT 'role_finance_staff', "id" FROM "AdminPermission" WHERE "key" = 'tasks.read';
