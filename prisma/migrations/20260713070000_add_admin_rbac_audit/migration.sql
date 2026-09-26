CREATE TABLE "AdminRole" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isSystem" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "AdminPermission" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "key" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT
);

CREATE TABLE "AdminRolePermission" (
  "roleId" TEXT NOT NULL,
  "permissionId" TEXT NOT NULL,
  PRIMARY KEY ("roleId", "permissionId"),
  CONSTRAINT "AdminRolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AdminRole" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AdminRolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "AdminPermission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AdminUserRole" (
  "userId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "assignedBy" TEXT,
  "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "roleId"),
  CONSTRAINT "AdminUserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AdminUserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "AdminRole" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AdminUserRole_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT,
  "actorEmail" TEXT,
  "action" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "beforeData" TEXT,
  "afterData" TEXT,
  "reason" TEXT,
  "metadata" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "AdminRole_key_key" ON "AdminRole"("key");
CREATE UNIQUE INDEX "AdminPermission_key_key" ON "AdminPermission"("key");
CREATE INDEX "AdminPermission_resource_action_idx" ON "AdminPermission"("resource", "action");
CREATE INDEX "AdminRolePermission_permissionId_idx" ON "AdminRolePermission"("permissionId");
CREATE INDEX "AdminUserRole_roleId_idx" ON "AdminUserRole"("roleId");
CREATE INDEX "AdminUserRole_assignedBy_idx" ON "AdminUserRole"("assignedBy");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_resource_createdAt_idx" ON "AuditLog"("resource", "createdAt");
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

INSERT INTO "AdminRole" ("id", "key", "name", "description", "updatedAt") VALUES
  ('role_super_admin', 'super_admin', '超级管理员', '全部管理能力', CURRENT_TIMESTAMP),
  ('role_product_admin', 'product_admin', '商品管理员', '商品、分类、价格、资料和库存', CURRENT_TIMESTAMP),
  ('role_order_admin', 'order_admin', '订单管理员', '询价、报价、订单和发货', CURRENT_TIMESTAMP),
  ('role_customer_admin', 'customer_admin', '客户管理员', '用户审核、等级、积分和账户限制', CURRENT_TIMESTAMP),
  ('role_content_admin', 'content_admin', '内容管理员', '实验方法、场景、公告和活动', CURRENT_TIMESTAMP),
  ('role_finance_staff', 'finance_staff', '财务人员', '成交价、付款、退款和报表', CURRENT_TIMESTAMP);

INSERT INTO "AdminPermission" ("id", "key", "resource", "action", "name") VALUES
  ('perm_admin_access', 'admin.access', 'admin', 'access', '访问管理后台'),
  ('perm_products_read', 'products.read', 'products', 'read', '查看商品'),
  ('perm_products_write', 'products.write', 'products', 'write', '修改商品'),
  ('perm_pricing_read', 'pricing.read', 'pricing', 'read', '查看价格'),
  ('perm_pricing_write', 'pricing.write', 'pricing', 'write', '修改价格'),
  ('perm_inventory_read', 'inventory.read', 'inventory', 'read', '查看库存'),
  ('perm_inventory_write', 'inventory.write', 'inventory', 'write', '修改库存'),
  ('perm_inquiries_read', 'inquiries.read', 'inquiries', 'read', '查看询价'),
  ('perm_inquiries_write', 'inquiries.write', 'inquiries', 'write', '处理询价'),
  ('perm_orders_read', 'orders.read', 'orders', 'read', '查看订单'),
  ('perm_orders_write', 'orders.write', 'orders', 'write', '处理订单'),
  ('perm_customers_read', 'customers.read', 'customers', 'read', '查看客户'),
  ('perm_customers_write', 'customers.write', 'customers', 'write', '管理客户'),
  ('perm_content_read', 'content.read', 'content', 'read', '查看内容'),
  ('perm_content_write', 'content.write', 'content', 'write', '管理内容'),
  ('perm_points_read', 'points.read', 'points', 'read', '查看积分'),
  ('perm_points_write', 'points.write', 'points', 'write', '调整积分'),
  ('perm_finance_read', 'finance.read', 'finance', 'read', '查看财务数据'),
  ('perm_finance_write', 'finance.write', 'finance', 'write', '处理财务事项'),
  ('perm_roles_manage', 'roles.manage', 'roles', 'manage', '管理角色权限'),
  ('perm_audit_read', 'audit.read', 'audit', 'read', '查看审计记录');

INSERT INTO "AdminRolePermission" ("roleId", "permissionId")
SELECT 'role_super_admin', "id" FROM "AdminPermission";

INSERT INTO "AdminRolePermission" ("roleId", "permissionId")
SELECT 'role_product_admin', "id" FROM "AdminPermission" WHERE "key" IN ('admin.access','products.read','products.write','pricing.read','pricing.write','inventory.read','inventory.write');
INSERT INTO "AdminRolePermission" ("roleId", "permissionId")
SELECT 'role_order_admin', "id" FROM "AdminPermission" WHERE "key" IN ('admin.access','inquiries.read','inquiries.write','orders.read','orders.write','customers.read','products.read','pricing.read','inventory.read','inventory.write');
INSERT INTO "AdminRolePermission" ("roleId", "permissionId")
SELECT 'role_customer_admin', "id" FROM "AdminPermission" WHERE "key" IN ('admin.access','customers.read','customers.write','points.read','points.write');
INSERT INTO "AdminRolePermission" ("roleId", "permissionId")
SELECT 'role_content_admin', "id" FROM "AdminPermission" WHERE "key" IN ('admin.access','content.read','content.write');
INSERT INTO "AdminRolePermission" ("roleId", "permissionId")
SELECT 'role_finance_staff', "id" FROM "AdminPermission" WHERE "key" IN ('admin.access','finance.read','finance.write','pricing.read','pricing.write','orders.read','customers.read','points.read','audit.read');

INSERT INTO "AdminUserRole" ("userId", "roleId")
SELECT "id", 'role_super_admin' FROM "User" WHERE "role" = 'admin';
