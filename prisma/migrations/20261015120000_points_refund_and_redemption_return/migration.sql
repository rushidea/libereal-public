-- 记录积分退款已对应的现金，避免多次部分退款按剩余积分重复乘比例。
ALTER TABLE "Order" ADD COLUMN "pointsRefundedCash" REAL NOT NULL DEFAULT 0;

-- 兑换取消只退一次积分、回一次库存。
ALTER TABLE "PointsRedemption" ADD COLUMN "pointsReturned" BOOLEAN NOT NULL DEFAULT false;
