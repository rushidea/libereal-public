-- CreateTable
CREATE TABLE "ResearchGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ResearchGroupMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ResearchGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResearchGroupMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupPointsLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "relatedId" TEXT,
    "actorUserId" TEXT,
    "adminEmail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GroupPointsLog_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ResearchGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupPointsLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointsTopup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "groupId" TEXT,
    "points" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "outTradeNo" TEXT,
    "tradeNo" TEXT,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PointsTopup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PointsTopup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ResearchGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- AlterTable Order points fields
ALTER TABLE "Order" ADD COLUMN "pointsPersonal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "pointsGroup" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "pointsGroupId" TEXT;
ALTER TABLE "Order" ADD COLUMN "pointsDiscount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "pointsApplied" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "pointsAppliedAt" DATETIME;
ALTER TABLE "Order" ADD COLUMN "pointsRefundedPersonal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "pointsRefundedGroup" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "ResearchGroupMember_userId_key" ON "ResearchGroupMember"("userId");
CREATE INDEX "ResearchGroupMember_groupId_idx" ON "ResearchGroupMember"("groupId");
CREATE INDEX "ResearchGroup_status_idx" ON "ResearchGroup"("status");
CREATE INDEX "ResearchGroup_name_idx" ON "ResearchGroup"("name");
CREATE INDEX "GroupPointsLog_groupId_createdAt_idx" ON "GroupPointsLog"("groupId", "createdAt");
CREATE INDEX "GroupPointsLog_type_idx" ON "GroupPointsLog"("type");
CREATE INDEX "GroupPointsLog_relatedId_idx" ON "GroupPointsLog"("relatedId");
CREATE UNIQUE INDEX "PointsTopup_outTradeNo_key" ON "PointsTopup"("outTradeNo");
CREATE INDEX "PointsTopup_userId_createdAt_idx" ON "PointsTopup"("userId", "createdAt");
CREATE INDEX "PointsTopup_groupId_idx" ON "PointsTopup"("groupId");
CREATE INDEX "PointsTopup_status_idx" ON "PointsTopup"("status");
CREATE INDEX "Order_pointsGroupId_idx" ON "Order"("pointsGroupId");
CREATE INDEX "PointsLog_relatedId_idx" ON "PointsLog"("relatedId");
