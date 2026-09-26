PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_AccountReceivable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "confirmedAt" DATETIME NOT NULL,
    "termStartedAt" DATETIME,
    "dueAt" DATETIME,
    "paymentTermDaysSnapshot" INTEGER NOT NULL DEFAULT 30,
    "paidAt" DATETIME,
    "lastReminderAt" DATETIME,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountReceivable_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccountReceivable_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_AccountReceivable" (
    "amount", "confirmedAt", "createdAt", "dueAt", "id", "lastReminderAt",
    "orderId", "paidAt", "reminderCount", "status", "updatedAt", "userId",
    "termStartedAt", "paymentTermDaysSnapshot"
)
SELECT
    "amount", "confirmedAt", "createdAt", "dueAt", "id", "lastReminderAt",
    "orderId", "paidAt", "reminderCount", "status", "updatedAt", "userId",
    "confirmedAt", 30
FROM "AccountReceivable";

DROP TABLE "AccountReceivable";
ALTER TABLE "new_AccountReceivable" RENAME TO "AccountReceivable";
CREATE UNIQUE INDEX "AccountReceivable_orderId_key" ON "AccountReceivable"("orderId");
CREATE INDEX "AccountReceivable_userId_status_idx" ON "AccountReceivable"("userId", "status");
CREATE INDEX "AccountReceivable_status_dueAt_idx" ON "AccountReceivable"("status", "dueAt");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

UPDATE "LegalDocument"
SET "version" = '2026-07-17.2'
WHERE "id" IN ('site-terms', 'site-sales-terms', 'customer-purchase', 'attachment-quote');
