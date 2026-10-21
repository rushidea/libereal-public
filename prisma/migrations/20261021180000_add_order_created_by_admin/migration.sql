-- 后台代客下单记录创建管理员。旧订单保持为空。
ALTER TABLE "Order" ADD COLUMN "created_by_admin_id" TEXT;
