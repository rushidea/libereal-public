ALTER TABLE "LegalDocument" ADD COLUMN "version" TEXT NOT NULL DEFAULT '1.0';
ALTER TABLE "User" ADD COLUMN "legalAcceptedSnapshot" TEXT;
ALTER TABLE "Order" ADD COLUMN "legalAcceptedSnapshot" TEXT;

UPDATE "LegalDocument" SET "version" = '2025-01-01' WHERE "id" = 'site-privacy';
UPDATE "LegalDocument" SET "version" = '2026-07-17' WHERE "id" IN (
  'site-terms',
  'site-sales-terms',
  'supplier-agreement',
  'customer-purchase',
  'attachment-quote'
);
UPDATE "LegalDocument" SET "version" = '2026-06-30' WHERE "version" = '1.0';
