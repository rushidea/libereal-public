ALTER TABLE "Order" ADD COLUMN "customerId" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
ALTER TABLE "Order" ADD COLUMN "paidAt" DATETIME;
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");
CREATE INDEX "Order_paidAt_idx" ON "Order"("paidAt");

CREATE TABLE "CreditAccount" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "baseLimit" REAL NOT NULL,
  "overrideLimit" REAL, "temporaryLimit" REAL NOT NULL DEFAULT 0, "temporaryUntil" DATETIME,
  "usedAmount" REAL NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'active',
  "paymentTermDays" INTEGER NOT NULL DEFAULT 30, "manuallyUnlockedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CreditAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "CreditTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "orderId" TEXT, "type" TEXT NOT NULL,
  "amount" REAL NOT NULL, "balanceAfter" REAL NOT NULL, "reason" TEXT, "actorId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CreditTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "AccountReceivable" (
  "id" TEXT NOT NULL PRIMARY KEY, "orderId" TEXT NOT NULL, "userId" TEXT NOT NULL, "amount" REAL NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open', "confirmedAt" DATETIME NOT NULL, "dueAt" DATETIME NOT NULL,
  "paidAt" DATETIME, "lastReminderAt" DATETIME, "reminderCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AccountReceivable_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AccountReceivable_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "UserTierHistory" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "fromTier" TEXT, "toTier" TEXT NOT NULL,
  "rollingSpend" REAL NOT NULL, "calculationFrom" DATETIME NOT NULL, "calculationTo" DATETIME NOT NULL,
  "reason" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserTierHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CreditAccount_userId_key" ON "CreditAccount"("userId");
CREATE INDEX "CreditAccount_status_idx" ON "CreditAccount"("status");
CREATE INDEX "CreditAccount_temporaryUntil_idx" ON "CreditAccount"("temporaryUntil");
CREATE INDEX "CreditTransaction_userId_createdAt_idx" ON "CreditTransaction"("userId", "createdAt");
CREATE INDEX "CreditTransaction_orderId_idx" ON "CreditTransaction"("orderId");
CREATE INDEX "CreditTransaction_type_idx" ON "CreditTransaction"("type");
CREATE UNIQUE INDEX "AccountReceivable_orderId_key" ON "AccountReceivable"("orderId");
CREATE INDEX "AccountReceivable_userId_status_idx" ON "AccountReceivable"("userId", "status");
CREATE INDEX "AccountReceivable_status_dueAt_idx" ON "AccountReceivable"("status", "dueAt");
CREATE INDEX "UserTierHistory_userId_createdAt_idx" ON "UserTierHistory"("userId", "createdAt");
CREATE INDEX "UserTierHistory_toTier_idx" ON "UserTierHistory"("toTier");

INSERT INTO "CreditAccount" ("id", "userId", "baseLimit", "createdAt", "updatedAt")
SELECT 'credit:' || hex("id"), "id",
  CASE "tier"
    WHEN '璞玉' THEN 5000 WHEN '岫岩玉' THEN 10000 WHEN '独山玉' THEN 20000 WHEN '蓝田玉' THEN 30000
    WHEN '和田玉' THEN 40000 WHEN '翡翠' THEN 50000 WHEN '羊脂白玉' THEN 70000 WHEN '帝王绿翡翠' THEN 80000
    ELSE 5000 END,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User";
