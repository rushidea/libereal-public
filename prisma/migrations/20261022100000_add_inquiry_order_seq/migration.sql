-- 询价分批确认的序号映射。公开订单号不使用这个整数。旧订单保持为空。
ALTER TABLE "Order" ADD COLUMN "inquiry_order_seq" INTEGER;

-- 同一询价内序号唯一。SQLite 把 NULL 当成互不相同，购物车订单和旧订单可以没有序号。
CREATE UNIQUE INDEX "Order_inquiryId_inquiryOrderSeq_key" ON "Order"("inquiryId", "inquiry_order_seq");
