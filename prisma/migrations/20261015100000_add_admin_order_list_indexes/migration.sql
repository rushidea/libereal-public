-- 活跃订单列表按未归档 + 创建时间倒序分页，状态筛选走同一前缀。
CREATE INDEX "Order_archivedAt_createdAt_idx" ON "Order"("archivedAt", "createdAt");
CREATE INDEX "Order_archivedAt_status_createdAt_idx" ON "Order"("archivedAt", "status", "createdAt");
