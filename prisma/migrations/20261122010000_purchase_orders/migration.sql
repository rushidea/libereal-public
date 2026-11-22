CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "groupKey" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('draft','approved','ordered','on_hold','superseded')),
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "approvedHash" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX "PurchaseOrder_id_orderId_key" ON "PurchaseOrder"("id","orderId");
CREATE INDEX "PurchaseOrder_orderId_status_idx" ON "PurchaseOrder"("orderId","status");
-- A later batch can be prepared after the preceding purchase order has been approved.
CREATE UNIQUE INDEX "PurchaseOrder_open_group" ON "PurchaseOrder"("orderId","groupKey") WHERE "status" = 'draft';

CREATE TABLE "PurchaseRequirement" (
  "orderItemId" TEXT NOT NULL PRIMARY KEY REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "ownerId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "terms" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "purchaseOrderId" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("purchaseOrderId","orderId") REFERENCES "PurchaseOrder"("id","orderId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PurchaseRequirement_orderId_idx" ON "PurchaseRequirement"("orderId");
CREATE INDEX "PurchaseRequirement_purchaseOrderId_idx" ON "PurchaseRequirement"("purchaseOrderId");

CREATE TABLE "PurchaseActivity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "purchaseOrderId" TEXT,
  "orderItemId" TEXT,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "requestKey" TEXT,
  "referenceKey" TEXT,
  "amountCents" BIGINT CHECK ("amountCents" IS NULL OR (typeof("amountCents") = 'integer' AND "amountCents" > 0)),
  "detail" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  FOREIGN KEY ("purchaseOrderId","orderId") REFERENCES "PurchaseOrder"("id","orderId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PurchaseActivity_requestKey_key" ON "PurchaseActivity"("requestKey");
CREATE UNIQUE INDEX "PurchaseActivity_referenceKey_key" ON "PurchaseActivity"("referenceKey");
CREATE INDEX "PurchaseActivity_orderId_createdAt_idx" ON "PurchaseActivity"("orderId","createdAt");

-- Define assignable roles; assigning any of them to a person is a separate existing admin action.
INSERT INTO AdminPermission (id,key,resource,action,name) VALUES
 ('perm_purchases_read','purchases.read','purchases','read','查看采购单'),
 ('perm_purchases_write','purchases.write','purchases','write','采购准备与订购登记'),
 ('perm_purchases_approve','purchases.approve','purchases','approve','独立批准采购单'),
 ('perm_purchases_pay','purchases.pay','purchases','pay','核实供应商实际付款');
INSERT INTO AdminRole (id,key,name,description,updatedAt) VALUES
 ('role_purchase_operator','purchase_operator','采购经办','采购资料、订购结果和供应商协调',CURRENT_TIMESTAMP),
 ('role_purchase_approver','purchase_approver','采购审批','按具体版本审核供应商采购单',CURRENT_TIMESTAMP),
 ('role_purchase_finance','purchase_finance','采购财务','核实供应商付款条件与实际凭证',CURRENT_TIMESTAMP);
INSERT INTO AdminRolePermission (roleId,permissionId)
 SELECT r.id,p.id FROM AdminRole r CROSS JOIN AdminPermission p
 WHERE r.key IN ('purchase_operator','purchase_approver','purchase_finance') AND
 (p.key IN ('admin.access','purchases.read') OR (r.key='purchase_operator' AND p.key='purchases.write')
 OR (r.key='purchase_approver' AND p.key='purchases.approve') OR (r.key='purchase_finance' AND p.key='purchases.pay'));
