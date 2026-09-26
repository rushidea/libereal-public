CREATE TABLE "AlipayMessageReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notifyId" TEXT NOT NULL,
    "msgMethod" TEXT NOT NULL,
    "notifyType" TEXT,
    "appId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "AlipayMessageReceipt_notifyId_key"
ON "AlipayMessageReceipt"("notifyId");

CREATE INDEX "AlipayMessageReceipt_msgMethod_status_idx"
ON "AlipayMessageReceipt"("msgMethod", "status");

CREATE INDEX "AlipayMessageReceipt_receivedAt_idx"
ON "AlipayMessageReceipt"("receivedAt");
