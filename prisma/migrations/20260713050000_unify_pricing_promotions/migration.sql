ALTER TABLE "Product" ADD COLUMN "minimumSalePrice" REAL;
ALTER TABLE "QuoteItem" ADD COLUMN "pricingSnapshot" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "pricingSnapshot" TEXT;

CREATE TABLE "Promotion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" REAL NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "startsAt" DATETIME NOT NULL,
  "endsAt" DATETIME NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "exclusive" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "PromotionProduct" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "promotionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT,
  CONSTRAINT "PromotionProduct_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PromotionProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PromotionProduct_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Promotion_status_startsAt_endsAt_idx" ON "Promotion"("status", "startsAt", "endsAt");
CREATE INDEX "Promotion_priority_idx" ON "Promotion"("priority");
CREATE UNIQUE INDEX "PromotionProduct_promotionId_productId_variantId_key" ON "PromotionProduct"("promotionId", "productId", "variantId");
CREATE INDEX "PromotionProduct_productId_variantId_idx" ON "PromotionProduct"("productId", "variantId");
