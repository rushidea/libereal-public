ALTER TABLE "GroupPointsLog" ADD COLUMN "organization_id" TEXT REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "GroupPointsLog_organization_id_createdAt_idx"
ON "GroupPointsLog"("organization_id", "createdAt");
