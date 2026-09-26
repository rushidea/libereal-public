DROP INDEX IF EXISTS "GroupPointsLog_organization_id_createdAt_idx";

ALTER TABLE "GroupPointsLog" DROP COLUMN "organization_id";
