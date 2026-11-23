-- A free after-sales exchange remains separate from the quantities delivered under the original order.
ALTER TABLE "FulfillmentParcelLine" ADD COLUMN "afterSaleApprovalId" TEXT
  REFERENCES "AfterSaleEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "FulfillmentParcelLine_afterSaleApprovalId_idx" ON "FulfillmentParcelLine" ("afterSaleApprovalId");
