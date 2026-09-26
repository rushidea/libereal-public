PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- A previous SQLite table rebuild may leave this duplicate table behind.
-- The canonical Order table remains untouched until the replacement copy succeeds.
DROP TABLE IF EXISTS "new_Order";

CREATE TABLE "new_Order" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "inquiryId" TEXT,
  "email" TEXT NOT NULL,
  "customerId" TEXT,
  "subtotal" REAL NOT NULL,
  "adjustmentTotal" REAL NOT NULL DEFAULT 0,
  "total" REAL NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "paymentMethod" TEXT,
  "legalAcceptedIds" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "archivedAt" DATETIME,
  "paidAt" DATETIME,
  "quoteSent" BOOLEAN NOT NULL DEFAULT false,
  "quoteSentAt" DATETIME,
  CONSTRAINT "Order_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Order" (
  "id", "inquiryId", "email", "customerId", "subtotal", "adjustmentTotal", "total",
  "status", "paymentMethod", "legalAcceptedIds", "createdAt", "updatedAt", "archivedAt",
  "paidAt", "quoteSent", "quoteSentAt"
)
SELECT
  "id", "inquiryId", "email", "customerId", "subtotal", 0, "subtotal",
  "status", "paymentMethod", "legalAcceptedIds", "createdAt", "updatedAt", "archivedAt",
  "paidAt", "quoteSent", "quoteSentAt"
FROM "Order";

CREATE TABLE "OrderAddressSnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "sourceAddressId" TEXT,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "institution" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderAddressSnapshot_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "OrderAddressSnapshot" ("id", "orderId", "sourceAddressId", "name", "phone", "address", "institution", "createdAt")
SELECT lower(hex(randomblob(16))), "id", "addressId", COALESCE("addressName", ''), COALESCE("addressPhone", ''), COALESCE("addressText", ''), "addressInstitution", "createdAt"
FROM "Order"
WHERE "addressName" IS NOT NULL OR "addressPhone" IS NOT NULL OR "addressText" IS NOT NULL;

DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";

CREATE TABLE "OrderAdjustment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "amount" REAL NOT NULL,
  "reason" TEXT,
  "createdBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderAdjustment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Shipment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'logistics',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "carrier" TEXT,
  "trackingNumber" TEXT,
  "pickupPoint" TEXT,
  "contactName" TEXT,
  "contactPhone" TEXT,
  "note" TEXT,
  "shippedAt" DATETIME,
  "deliveredAt" DATETIME,
  "createdBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ShipmentItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shipmentId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShipmentItem_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShipmentItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "OrderEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actorId" TEXT,
  "actorEmail" TEXT,
  "message" TEXT,
  "metadata" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OrderAddressSnapshot_orderId_key" ON "OrderAddressSnapshot"("orderId");
CREATE INDEX "OrderAddressSnapshot_sourceAddressId_idx" ON "OrderAddressSnapshot"("sourceAddressId");
CREATE INDEX "OrderAdjustment_orderId_createdAt_idx" ON "OrderAdjustment"("orderId", "createdAt");
CREATE INDEX "OrderAdjustment_type_idx" ON "OrderAdjustment"("type");
CREATE INDEX "Shipment_orderId_createdAt_idx" ON "Shipment"("orderId", "createdAt");
CREATE INDEX "Shipment_trackingNumber_idx" ON "Shipment"("trackingNumber");
CREATE INDEX "Shipment_status_idx" ON "Shipment"("status");
CREATE UNIQUE INDEX "ShipmentItem_shipmentId_orderItemId_key" ON "ShipmentItem"("shipmentId", "orderItemId");
CREATE INDEX "ShipmentItem_orderItemId_idx" ON "ShipmentItem"("orderItemId");
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");
CREATE INDEX "OrderEvent_type_idx" ON "OrderEvent"("type");
CREATE INDEX "Order_email_idx" ON "Order"("email");
CREATE INDEX "Order_inquiryId_idx" ON "Order"("inquiryId");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_archivedAt_idx" ON "Order"("archivedAt");
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");
CREATE INDEX "Order_paidAt_idx" ON "Order"("paidAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
