CREATE TABLE "CustomerCashPosting" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "receivableId" TEXT REFERENCES "AccountReceivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "bankAllocationId" TEXT REFERENCES "PurchaseActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "paymentAttemptId" TEXT REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "creditTransactionId" TEXT REFERENCES "CreditTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amountCents" BIGINT NOT NULL CHECK ("amountCents" > 0),
  "releasedCents" BIGINT NOT NULL DEFAULT 0 CHECK ("releasedCents" BETWEEN 0 AND "amountCents"),
  "actorId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (("bankAllocationId" IS NULL) <> ("paymentAttemptId" IS NULL)),
  CHECK (("releasedCents" = 0) = ("creditTransactionId" IS NULL)),
  CHECK ("creditTransactionId" IS NULL OR "receivableId" IS NOT NULL)
);
CREATE UNIQUE INDEX "CustomerCashPosting_bankAllocationId_key" ON "CustomerCashPosting"("bankAllocationId");
CREATE UNIQUE INDEX "CustomerCashPosting_paymentAttemptId_key" ON "CustomerCashPosting"("paymentAttemptId");
CREATE UNIQUE INDEX "CustomerCashPosting_creditTransactionId_key" ON "CustomerCashPosting"("creditTransactionId");
CREATE INDEX "CustomerCashPosting_orderId_idx" ON "CustomerCashPosting"("orderId");

CREATE TABLE "FinanceInvoicePlan" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "purchaseOrderId" TEXT,
  "side" TEXT NOT NULL CHECK ("side" IN ('customer','supplier')),
  "partyKey" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "grossCents" BIGINT NOT NULL CHECK ("grossCents" > 0),
  "trigger" TEXT NOT NULL CHECK ("trigger" IN ('accepted','dispatched','delivered','paid','manual')),
  "ownerId" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("purchaseOrderId","orderId") REFERENCES "PurchaseOrder"("id","orderId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK (("side" = 'customer') = ("purchaseOrderId" IS NULL))
);
CREATE INDEX "FinanceInvoicePlan_orderId_side_idx" ON "FinanceInvoicePlan"("orderId","side");
CREATE INDEX "FinanceInvoicePlan_purchaseOrderId_idx" ON "FinanceInvoicePlan"("purchaseOrderId");

CREATE TABLE "FinanceInvoice" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "side" TEXT NOT NULL CHECK ("side" IN ('customer','supplier')),
  "partyKey" TEXT NOT NULL,
  "issuer" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "issuedAt" DATETIME NOT NULL,
  "grossCents" BIGINT NOT NULL CHECK ("grossCents" > 0),
  "actorId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "FinanceInvoice_identityKey_key" ON "FinanceInvoice"("identityKey");
CREATE UNIQUE INDEX "FinanceInvoice_sha256_key" ON "FinanceInvoice"("sha256");

CREATE TABLE "FinanceInvoiceAllocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "planId" TEXT NOT NULL REFERENCES "FinanceInvoicePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "invoiceId" TEXT NOT NULL REFERENCES "FinanceInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amountCents" BIGINT NOT NULL CHECK ("amountCents" > 0)
);
CREATE UNIQUE INDEX "FinanceInvoiceAllocation_planId_invoiceId_key" ON "FinanceInvoiceAllocation"("planId","invoiceId");
CREATE INDEX "FinanceInvoiceAllocation_invoiceId_idx" ON "FinanceInvoiceAllocation"("invoiceId");

CREATE TABLE "FinanceEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "planId" TEXT REFERENCES "FinanceInvoicePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "invoiceId" TEXT REFERENCES "FinanceInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "action" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "intentHash" TEXT NOT NULL,
  "approvedHash" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "FinanceEvent_requestKey_key" ON "FinanceEvent"("requestKey");
CREATE INDEX "FinanceEvent_orderId_createdAt_idx" ON "FinanceEvent"("orderId","createdAt");
CREATE INDEX "FinanceEvent_invoiceId_idx" ON "FinanceEvent"("invoiceId");
