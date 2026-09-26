-- Schema-only invariant. Existing active duplicates abort index creation.
-- Reconcile financial records separately before retrying; never mutate them here.
CREATE UNIQUE INDEX "PaymentAttempt_active_alipay_order_key"
ON "PaymentAttempt"("orderId")
WHERE "provider" = 'alipay' AND "status" IN ('created', 'redirected', 'WAIT_BUYER_PAY');
