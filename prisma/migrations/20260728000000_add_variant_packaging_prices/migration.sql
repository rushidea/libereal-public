-- Add per-packaging price fields to ProductVariant so consumable packagings
-- can carry their own promotional/cost/minimum-sale prices.
ALTER TABLE "ProductVariant" ADD COLUMN "promotionalPrice" REAL;
ALTER TABLE "ProductVariant" ADD COLUMN "costPrice" REAL;
ALTER TABLE "ProductVariant" ADD COLUMN "minimumSalePrice" REAL;
