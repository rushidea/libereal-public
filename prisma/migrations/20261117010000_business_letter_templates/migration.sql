CREATE TABLE "BusinessLetterTemplate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "enabled" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TEXT NOT NULL
);

CREATE TABLE "BusinessLetterDraft" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "templateId" TEXT NOT NULL,
  "templateRevision" INTEGER NOT NULL,
  "businessReference" TEXT NOT NULL,
  "snapshot" TEXT NOT NULL,
  "approvalHash" TEXT NOT NULL UNIQUE,
  "deliveryKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "origin" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "approvedBy" TEXT,
  "approvedAt" TEXT,
  "result" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("templateId") REFERENCES "BusinessLetterTemplate"("id") ON DELETE RESTRICT
);
CREATE INDEX "BusinessLetterDraft_createdAt_idx" ON "BusinessLetterDraft"("createdAt");
-- Separate authorization versions from the once-only identity of the actual outgoing message.
-- Prisma cannot express this SQLite partial index; retain it in future migrations.
CREATE UNIQUE INDEX "BusinessLetterDraft_delivery_once" ON "BusinessLetterDraft"("deliveryKey")
  WHERE "status" IN ('sending', 'accepted', 'rejected', 'unknown');
