-- Preserve existing brand policy until a specific change is previewed and approved.
ALTER TABLE "Brand" ADD COLUMN "supplierQuoteRequiredAbove" REAL;
