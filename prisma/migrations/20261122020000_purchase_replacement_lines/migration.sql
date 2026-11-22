-- Preserve the original purchase and its dated business receipts.
-- Replacement lines belong to a separate purchase and retain the customer and supplier lineage.
CREATE TABLE "PurchaseReplacementLine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "orderItemId" TEXT NOT NULL REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fromPurchaseOrderId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL CHECK ("purchaseOrderId" <> "fromPurchaseOrderId"),
  "authorizationId" TEXT NOT NULL REFERENCES "PurchaseActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "quantity" INTEGER NOT NULL CHECK (typeof("quantity") = 'integer' AND "quantity" > 0),
  "ownerId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "terms" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("fromPurchaseOrderId","orderId") REFERENCES "PurchaseOrder"("id","orderId") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("purchaseOrderId","orderId") REFERENCES "PurchaseOrder"("id","orderId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PurchaseReplacementLine_purchaseOrderId_orderItemId_key" ON "PurchaseReplacementLine"("purchaseOrderId","orderItemId");
CREATE UNIQUE INDEX "PurchaseReplacementLine_authorizationId_orderItemId_key" ON "PurchaseReplacementLine"("authorizationId","orderItemId");
CREATE INDEX "PurchaseReplacementLine_orderId_idx" ON "PurchaseReplacementLine"("orderId");
CREATE INDEX "PurchaseReplacementLine_fromPurchaseOrderId_idx" ON "PurchaseReplacementLine"("fromPurchaseOrderId");
