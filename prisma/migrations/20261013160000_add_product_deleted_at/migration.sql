-- Soft-delete catalog products without cascading order, quote, or inventory history.
ALTER TABLE "Product" ADD COLUMN "deletedAt" DATETIME;

CREATE INDEX "Product_deletedAt_idx" ON "Product"("deletedAt");
