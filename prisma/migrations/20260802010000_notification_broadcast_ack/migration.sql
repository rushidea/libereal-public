-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'personal';
ALTER TABLE "Notification" ADD COLUMN "requiresAck" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Notification" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "deletedAt" DATETIME;

-- CreateIndex
CREATE INDEX "Notification_scope_deletedAt_idx" ON "Notification"("scope", "deletedAt");
CREATE INDEX "Notification_requiresAck_deletedAt_idx" ON "Notification"("requiresAck", "deletedAt");

-- CreateTable
CREATE TABLE "NotificationReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationReceipt_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationReceipt_notificationId_userId_key" ON "NotificationReceipt"("notificationId", "userId");
CREATE INDEX "NotificationReceipt_userId_idx" ON "NotificationReceipt"("userId");
CREATE INDEX "NotificationReceipt_acknowledgedAt_idx" ON "NotificationReceipt"("acknowledgedAt");
