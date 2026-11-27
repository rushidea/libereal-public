-- CreateTable
CREATE TABLE "FulfillmentParcel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "route" TEXT NOT NULL CHECK ("route" IN ('supplier_to_customer', 'supplier_to_libereal', 'libereal_to_customer', 'legacy_customer')),
    "carrier" TEXT,
    "trackingNumber" TEXT,
    "feedSource" TEXT,
    "status" TEXT NOT NULL,
    "dispatchedAt" DATETIME NOT NULL,
    "reference" TEXT NOT NULL,
    "evidenceSha256" TEXT NOT NULL,
    "evidenceRow" INTEGER NOT NULL CHECK ("evidenceRow" > 0),
    "requestKey" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FulfillmentParcel_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FulfillmentParcel_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FulfillmentParcelLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "orderItemId" TEXT NOT NULL,
    "sourceReceiptId" TEXT,
    "catalogNumber" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0 CHECK ("receivedQuantity" BETWEEN 0 AND "quantity"),
    CONSTRAINT "FulfillmentParcelLine_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "FulfillmentParcel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FulfillmentParcelLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FulfillmentParcelLine_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FulfillmentParcelLine_sourceReceiptId_fkey" FOREIGN KEY ("sourceReceiptId") REFERENCES "FulfillmentReceipt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FulfillmentReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelLineId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "inventoryBatchId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
    "forwardedQuantity" INTEGER NOT NULL DEFAULT 0 CHECK ("forwardedQuantity" BETWEEN 0 AND "quantity"),
    CONSTRAINT "FulfillmentReceipt_parcelLineId_fkey" FOREIGN KEY ("parcelLineId") REFERENCES "FulfillmentParcelLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FulfillmentReceipt_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "FulfillmentEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FulfillmentReceipt_inventoryBatchId_fkey" FOREIGN KEY ("inventoryBatchId") REFERENCES "InventoryBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FulfillmentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parcelId" TEXT,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "requestKey" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "evidenceSha256" TEXT NOT NULL,
    "evidenceRow" INTEGER NOT NULL CHECK ("evidenceRow" > 0),
    "details" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FulfillmentEvent_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "FulfillmentParcel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Existing reservation identities, quantities and allocation links survive the upgrade.
ALTER TABLE "InventoryReservation" ADD COLUMN "releasedQuantity" INTEGER NOT NULL DEFAULT 0 CHECK ("releasedQuantity" >= 0 AND "releasedQuantity" + "fulfilledQuantity" <= "quantity");
ALTER TABLE "InventoryReservationBatch" ADD COLUMN "releasedQuantity" INTEGER NOT NULL DEFAULT 0 CHECK ("releasedQuantity" >= 0 AND "releasedQuantity" + "fulfilledQuantity" <= "quantity");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentParcel_shipmentId_key" ON "FulfillmentParcel"("shipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentParcel_requestKey_key" ON "FulfillmentParcel"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentParcel_businessKey_key" ON "FulfillmentParcel"("businessKey");

-- CreateIndex
CREATE INDEX "FulfillmentParcel_orderId_createdAt_idx" ON "FulfillmentParcel"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "FulfillmentParcel_feedSource_carrier_trackingNumber_idx" ON "FulfillmentParcel"("feedSource", "carrier", "trackingNumber");

-- CreateIndex
CREATE INDEX "FulfillmentParcelLine_parcelId_idx" ON "FulfillmentParcelLine"("parcelId");

-- CreateIndex
CREATE INDEX "FulfillmentParcelLine_purchaseOrderId_orderItemId_idx" ON "FulfillmentParcelLine"("purchaseOrderId", "orderItemId");

-- CreateIndex
CREATE INDEX "FulfillmentParcelLine_sourceReceiptId_idx" ON "FulfillmentParcelLine"("sourceReceiptId");

-- CreateIndex
CREATE INDEX "FulfillmentReceipt_inventoryBatchId_idx" ON "FulfillmentReceipt"("inventoryBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentReceipt_parcelLineId_eventId_inventoryBatchId_key" ON "FulfillmentReceipt"("parcelLineId", "eventId", "inventoryBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentEvent_requestKey_key" ON "FulfillmentEvent"("requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentEvent_businessKey_key" ON "FulfillmentEvent"("businessKey");

-- CreateIndex
CREATE INDEX "FulfillmentEvent_parcelId_occurredAt_idx" ON "FulfillmentEvent"("parcelId", "occurredAt");

-- CreateIndex
CREATE INDEX "FulfillmentEvent_source_status_idx" ON "FulfillmentEvent"("source", "status");

