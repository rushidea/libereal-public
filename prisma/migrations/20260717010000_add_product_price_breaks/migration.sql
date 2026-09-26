ALTER TABLE "Product" ADD COLUMN "salesUnit" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN "packageType" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN "salesUnit" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN "baseQuantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProductVariant" ADD COLUMN "source" TEXT;

CREATE INDEX "ProductVariant_productId_packageType_baseQuantity_idx" ON "ProductVariant"("productId", "packageType", "baseQuantity");
CREATE INDEX "ProductVariant_source_idx" ON "ProductVariant"("source");

CREATE TABLE "ProductPriceBreak" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "salesUnit" TEXT,
    "baseQuantity" INTEGER NOT NULL DEFAULT 1,
    "listAmount" REAL,
    "publicAmount" REAL,
    "costAmount" REAL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "source" TEXT,
    "sourceSheet" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductPriceBreak_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductPriceBreak_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ProductPriceBreak_productId_kind_baseQuantity_idx" ON "ProductPriceBreak"("productId", "kind", "baseQuantity");
CREATE INDEX "ProductPriceBreak_variantId_idx" ON "ProductPriceBreak"("variantId");
CREATE INDEX "ProductPriceBreak_source_idx" ON "ProductPriceBreak"("source");
