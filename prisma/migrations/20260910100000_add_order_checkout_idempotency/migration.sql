ALTER TABLE "Order" ADD COLUMN "checkoutAttemptId" TEXT;
ALTER TABLE "Order" ADD COLUMN "checkout_request_fingerprint" TEXT;

CREATE UNIQUE INDEX "Order_checkoutAttemptId_key" ON "Order"("checkoutAttemptId");
CREATE INDEX "Order_checkoutRequestFingerprint_idx" ON "Order"("checkout_request_fingerprint");

ALTER TABLE "Inquiry" ADD COLUMN "checkoutAttemptId" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "checkout_request_fingerprint" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "has_unresolved_pricing" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Inquiry_checkoutAttemptId_key" ON "Inquiry"("checkoutAttemptId");
CREATE INDEX "Inquiry_checkoutRequestFingerprint_idx" ON "Inquiry"("checkout_request_fingerprint");
