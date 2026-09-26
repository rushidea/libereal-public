CREATE INDEX "Product_target_idx" ON "Product"("target");
CREATE INDEX "Product_brand_category_idx" ON "Product"("brand", "category");
CREATE INDEX "Product_category_subcategory_idx" ON "Product"("category", "subcategory");
CREATE INDEX "Product_promotion_hazardous_idx" ON "Product"("promotion", "hazardous");

CREATE TABLE "TransientEntry" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "value" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "TransientEntry_expiresAt_idx" ON "TransientEntry"("expiresAt");
