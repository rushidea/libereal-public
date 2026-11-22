ALTER TABLE "FulfillmentReceipt" ADD COLUMN "releasedQuantity" INTEGER NOT NULL DEFAULT 0
  CHECK ("releasedQuantity" >= 0 AND "forwardedQuantity" + "releasedQuantity" <= "quantity");

CREATE TABLE "FulfillmentLineResolution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "parcelLineId" TEXT NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('shortage', 'loss', 'return')),
    "quantity" INTEGER NOT NULL CHECK ("quantity" > 0),
    CONSTRAINT "FulfillmentLineResolution_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "FulfillmentEvent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FulfillmentLineResolution_parcelLineId_fkey" FOREIGN KEY ("parcelLineId") REFERENCES "FulfillmentParcelLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "FulfillmentLineResolution_eventId_parcelLineId_key" ON "FulfillmentLineResolution"("eventId", "parcelLineId");
CREATE INDEX "FulfillmentLineResolution_parcelLineId_idx" ON "FulfillmentLineResolution"("parcelLineId");
