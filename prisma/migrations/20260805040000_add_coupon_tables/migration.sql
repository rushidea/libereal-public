-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "threshold" REAL NOT NULL DEFAULT 0,
    "discount" REAL NOT NULL,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvalStatus" TEXT NOT NULL DEFAULT 'auto',
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATETIME,
    "maxUses" INTEGER NOT NULL DEFAULT 0,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CouponInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "couponId" TEXT NOT NULL,
    "userId" TEXT,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "issueApprovalStatus" TEXT NOT NULL DEFAULT 'auto',
    "issuedBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "redeemedOrderId" TEXT,
    "redeemedAt" DATETIME,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CouponInstance_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CouponInstance_code_key" ON "CouponInstance"("code");
CREATE INDEX "Coupon_type_approvalStatus_idx" ON "Coupon"("type", "approvalStatus");
CREATE INDEX "Coupon_validUntil_idx" ON "Coupon"("validUntil");
CREATE INDEX "CouponInstance_userId_status_idx" ON "CouponInstance"("userId", "status");
CREATE INDEX "CouponInstance_code_idx" ON "CouponInstance"("code");
CREATE INDEX "CouponInstance_couponId_idx" ON "CouponInstance"("couponId");
CREATE INDEX "CouponInstance_redeemedOrderId_idx" ON "CouponInstance"("redeemedOrderId");
