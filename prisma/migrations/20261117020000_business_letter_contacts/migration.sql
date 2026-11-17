CREATE TABLE "BusinessLetterContact" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyName" TEXT NOT NULL,
  "contactName" TEXT NOT NULL,
  "salutation" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "qq" TEXT NOT NULL DEFAULT '',
  "brandIds" TEXT NOT NULL DEFAULT '[]',
  "notes" TEXT NOT NULL DEFAULT '',
  "sourceReference" TEXT NOT NULL DEFAULT '',
  "enabled" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL
);
CREATE INDEX "BusinessLetterContact_companyName_contactName_idx" ON "BusinessLetterContact"("companyName", "contactName");
