-- 为 Order 增加自动关闭时刻字段：pending 超时（48h）后由定时任务关闭
ALTER TABLE "Order" ADD COLUMN "auto_close_at" DATETIME;

-- 回填存量 pending 订单：autoCloseAt = createdAt + 48h
UPDATE "Order"
SET "auto_close_at" = datetime(createdAt, '+48 hours')
WHERE status = 'pending'
  AND archivedAt IS NULL
  AND "auto_close_at" IS NULL;

CREATE INDEX "Order_status_auto_close_at_idx" ON "Order"("status", "auto_close_at");
