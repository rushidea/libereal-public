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
