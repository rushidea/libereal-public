ALTER TABLE "Product" ADD COLUMN "pricingMode" TEXT NOT NULL DEFAULT 'fixed';

UPDATE "Product"
SET "pricingMode" = 'inquiry', "price" = -1
WHERE "price" <= 0;

CREATE INDEX "Product_pricingMode_idx" ON "Product"("pricingMode");
