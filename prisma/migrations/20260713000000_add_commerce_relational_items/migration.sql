-- Introduce relational commerce records while retaining the legacy JSON snapshots.
CREATE TABLE "InquiryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inquiryId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT,
    "catalogNumber" TEXT,
    "name" TEXT NOT NULL,
    "unitPrice" REAL,
    "clientPrice" REAL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "lineTotal" REAL,
    "leadTime" TEXT,
    "available" BOOLEAN,
    "ordered" BOOLEAN NOT NULL DEFAULT false,
    "pricingSource" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InquiryItem_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT,
    "catalogNumber" TEXT,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "unitPrice" REAL NOT NULL,
    "clientPrice" REAL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "shippedQty" INTEGER NOT NULL DEFAULT 0,
    "leadTime" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "reason" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InquiryItem_inquiryId_position_key" ON "InquiryItem"("inquiryId", "position");
CREATE INDEX "InquiryItem_inquiryId_idx" ON "InquiryItem"("inquiryId");
CREATE INDEX "InquiryItem_catalogNumber_idx" ON "InquiryItem"("catalogNumber");
CREATE INDEX "InquiryItem_productId_idx" ON "InquiryItem"("productId");
CREATE UNIQUE INDEX "OrderItem_orderId_position_key" ON "OrderItem"("orderId", "position");
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_catalogNumber_idx" ON "OrderItem"("catalogNumber");
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");
CREATE INDEX "OrderStatusHistory_toStatus_idx" ON "OrderStatusHistory"("toStatus");

-- No production transactions exist yet, so legacy JSON item snapshots are removed.
ALTER TABLE "Inquiry" DROP COLUMN "items";
ALTER TABLE "Order" DROP COLUMN "items";
