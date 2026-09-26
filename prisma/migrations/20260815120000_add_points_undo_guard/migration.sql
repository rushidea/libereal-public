ALTER TABLE "PointsLog" ADD COLUMN "undoOfId" TEXT;

-- 兼容旧版撤销记录：旧接口把原调整 ID 写在 relatedId 中。
-- 若历史数据出现同一原调整多条撤销，仅回填最早一条；其余记录仍由 relatedId 防重查询识别。
UPDATE "PointsLog" AS undo_log
SET "undoOfId" = "relatedId"
WHERE undo_log."type" = 'admin_undo'
  AND undo_log."relatedId" IS NOT NULL
  AND undo_log."undoOfId" IS NULL
  AND undo_log."id" = (
    SELECT MIN(previous_undo."id")
    FROM "PointsLog" AS previous_undo
    WHERE previous_undo."type" = 'admin_undo'
      AND previous_undo."relatedId" = undo_log."relatedId"
  );

CREATE UNIQUE INDEX "PointsLog_undoOfId_key" ON "PointsLog"("undoOfId");
CREATE INDEX "PointsLog_undoOfId_idx" ON "PointsLog"("undoOfId");
