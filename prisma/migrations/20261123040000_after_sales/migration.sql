CREATE UNIQUE INDEX "OrderItem_id_orderId_key" ON "OrderItem"("id", "orderId");

CREATE TABLE "AfterSaleCase" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "orderItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
  "relatedCents" BIGINT CHECK ("relatedCents" >= 0),
  "issue" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "report" TEXT NOT NULL,
  "reportedAt" DATETIME NOT NULL,
  "sourceReference" TEXT NOT NULL,
  "sourceSha256" TEXT NOT NULL,
  "sourceRow" INTEGER NOT NULL CHECK ("sourceRow" > 0),
  "sourceKey" TEXT NOT NULL,
  "shortfallId" TEXT REFERENCES "FulfillmentLineResolution"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdBy" TEXT NOT NULL,
  "ownerId" TEXT,
  "customerState" TEXT NOT NULL DEFAULT 'reported',
  "supplierState" TEXT NOT NULL DEFAULT 'unreviewed',
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("orderItemId", "orderId") REFERENCES "OrderItem"("id", "orderId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AfterSaleCase_sourceKey_key" ON "AfterSaleCase"("sourceKey");
CREATE INDEX "AfterSaleCase_shortfallId_idx" ON "AfterSaleCase"("shortfallId");
CREATE INDEX "AfterSaleCase_orderId_orderItemId_idx" ON "AfterSaleCase"("orderId", "orderItemId");
CREATE INDEX "AfterSaleCase_customerState_supplierState_idx" ON "AfterSaleCase"("customerState", "supplierState");

CREATE TABLE "AfterSaleEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "caseId" TEXT NOT NULL REFERENCES "AfterSaleCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "action" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "businessKey" TEXT NOT NULL,
  "intentHash" TEXT NOT NULL,
  "approvedHash" TEXT NOT NULL,
  "occurredAt" DATETIME NOT NULL,
  "reference" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "documentRow" INTEGER NOT NULL CHECK ("documentRow" > 0),
  "detail" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AfterSaleEvent_requestKey_key" ON "AfterSaleEvent"("requestKey");
CREATE UNIQUE INDEX "AfterSaleEvent_businessKey_key" ON "AfterSaleEvent"("businessKey");
CREATE INDEX "AfterSaleEvent_caseId_createdAt_idx" ON "AfterSaleEvent"("caseId", "createdAt");
