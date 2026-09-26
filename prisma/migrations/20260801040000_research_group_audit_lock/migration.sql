-- AlterTable ResearchGroup: audit + lock fields
ALTER TABLE "ResearchGroup" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ResearchGroup" ADD COLUMN "lockedAt" DATETIME;
ALTER TABLE "ResearchGroup" ADD COLUMN "reviewedAt" DATETIME;
ALTER TABLE "ResearchGroup" ADD COLUMN "reviewedByEmail" TEXT;

-- Existing active groups are treated as already approved and locked
UPDATE "ResearchGroup"
SET
  "locked" = true,
  "lockedAt" = CURRENT_TIMESTAMP,
  "reviewedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'active' AND "locked" = false;
