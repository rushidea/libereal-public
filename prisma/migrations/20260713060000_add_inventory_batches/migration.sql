CREATE TABLE "InventoryAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  "actualQuantity" INTEGER NOT NULL DEFAULT -1,
  "availableQuantity" INTEGER NOT NULL DEFAULT -1,
  "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
  "shippedQuantity" INTEGER NOT NULL DEFAULT 0,
  "inboundQuantity" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InventoryAccount_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InventoryAccount_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "InventoryBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "inventoryAccountId" TEXT NOT NULL,
  "batchNumber" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
  "expiryDate" DATETIME,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InventoryBatch_inventoryAccountId_fkey" FOREIGN KEY ("inventoryAccountId") REFERENCES "InventoryAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "InventoryReservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "inventoryAccountId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "fulfilledQuantity" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "InventoryReservation_inventoryAccountId_fkey" FOREIGN KEY ("inventoryAccountId") REFERENCES "InventoryAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InventoryReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InventoryReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "InventoryTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "inventoryAccountId" TEXT NOT NULL,
  "batchId" TEXT,
  "reservationId" TEXT,
  "orderId" TEXT,
  "type" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT,
  "actualBefore" INTEGER NOT NULL,
  "actualAfter" INTEGER NOT NULL,
  "availableBefore" INTEGER NOT NULL,
  "availableAfter" INTEGER NOT NULL,
  "reservedBefore" INTEGER NOT NULL,
  "reservedAfter" INTEGER NOT NULL,
  "inboundBefore" INTEGER NOT NULL,
  "inboundAfter" INTEGER NOT NULL,
  "shippedBefore" INTEGER NOT NULL,
  "shippedAfter" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryTransaction_inventoryAccountId_fkey" FOREIGN KEY ("inventoryAccountId") REFERENCES "InventoryAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InventoryTransaction_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "InventoryTransaction_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "InventoryTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "InventoryReservationBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reservationId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "fulfilledQuantity" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "InventoryReservationBatch_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InventoryReservationBatch_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InventoryAccount_productId_variantId_key" ON "InventoryAccount"("productId", "variantId");
CREATE INDEX "InventoryAccount_variantId_idx" ON "InventoryAccount"("variantId");
CREATE INDEX "InventoryAccount_availableQuantity_idx" ON "InventoryAccount"("availableQuantity");
CREATE UNIQUE INDEX "InventoryBatch_inventoryAccountId_batchNumber_key" ON "InventoryBatch"("inventoryAccountId", "batchNumber");
CREATE INDEX "InventoryBatch_expiryDate_idx" ON "InventoryBatch"("expiryDate");
CREATE UNIQUE INDEX "InventoryReservation_orderItemId_key" ON "InventoryReservation"("orderItemId");
CREATE INDEX "InventoryReservation_orderId_status_idx" ON "InventoryReservation"("orderId", "status");
CREATE INDEX "InventoryReservation_inventoryAccountId_status_idx" ON "InventoryReservation"("inventoryAccountId", "status");
CREATE INDEX "InventoryTransaction_inventoryAccountId_createdAt_idx" ON "InventoryTransaction"("inventoryAccountId", "createdAt");
CREATE INDEX "InventoryTransaction_orderId_idx" ON "InventoryTransaction"("orderId");
CREATE INDEX "InventoryTransaction_batchId_idx" ON "InventoryTransaction"("batchId");
CREATE INDEX "InventoryTransaction_type_idx" ON "InventoryTransaction"("type");
CREATE UNIQUE INDEX "InventoryReservationBatch_reservationId_batchId_key" ON "InventoryReservationBatch"("reservationId", "batchId");
CREATE INDEX "InventoryReservationBatch_batchId_idx" ON "InventoryReservationBatch"("batchId");

INSERT INTO "InventoryAccount" ("id", "productId", "actualQuantity", "availableQuantity", "createdAt", "updatedAt")
SELECT lower(hex(randomblob(16))), "id", "stockQuantity", "stockQuantity", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "Product";
