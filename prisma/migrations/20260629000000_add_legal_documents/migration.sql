-- CreateTable
CREATE TABLE "LegalDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'pdf',
    "fileName" TEXT,
    "sitePath" TEXT,
    "description" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "requireRegister" BOOLEAN NOT NULL DEFAULT false,
    "requireCheckout" BOOLEAN NOT NULL DEFAULT false,
    "showOnLegalPage" BOOLEAN NOT NULL DEFAULT true,
    "showOnOpenPlatform" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "role" TEXT NOT NULL DEFAULT 'customer',
    "phone" TEXT,
    "institution" TEXT,
    "department" TEXT,
    "identity" TEXT,
    "advisorName" TEXT,
    "advisorPhone" TEXT,
    "points" INTEGER NOT NULL DEFAULT 0,
    "discountRate" REAL,
    "brandDiscounts" TEXT,
    "sourceTemplateId" TEXT,
    "avatar" TEXT,
    "googleEmail" TEXT,
    "alipayId" TEXT,
    "alipayAvatar" TEXT,
    "alipayNickname" TEXT,
    "alipayGender" TEXT,
    "alipayCity" TEXT,
    "alipayProvince" TEXT,
    "isNewUser" BOOLEAN NOT NULL DEFAULT true,
    "approvalStatus" TEXT NOT NULL DEFAULT 'approved',
    "resetToken" TEXT,
    "resetTokenExpiry" DATETIME,
    "isBlacklisted" BOOLEAN NOT NULL DEFAULT false,
    "tier" TEXT NOT NULL DEFAULT '璞玉',
    "wechatNickname" TEXT,
    "sex" INTEGER,
    "displayAvatarUrl" TEXT,
    "emailVerified" DATETIME,
    "legalAcceptedAt" DATETIME,
    "legalAcceptedIds" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("advisorName", "advisorPhone", "alipayAvatar", "alipayCity", "alipayGender", "alipayId", "alipayNickname", "alipayProvince", "approvalStatus", "avatar", "brandDiscounts", "createdAt", "department", "discountRate", "displayAvatarUrl", "email", "emailVerified", "googleEmail", "id", "identity", "institution", "isBlacklisted", "isNewUser", "name", "password", "phone", "points", "resetToken", "resetTokenExpiry", "role", "sex", "sourceTemplateId", "tier", "updatedAt", "wechatNickname") SELECT "advisorName", "advisorPhone", "alipayAvatar", "alipayCity", "alipayGender", "alipayId", "alipayNickname", "alipayProvince", "approvalStatus", "avatar", "brandDiscounts", "createdAt", "department", "discountRate", "displayAvatarUrl", "email", "emailVerified", "googleEmail", "id", "identity", "institution", "isBlacklisted", "isNewUser", "name", "password", "phone", "points", "resetToken", "resetTokenExpiry", "role", "sex", "sourceTemplateId", "tier", "updatedAt", "wechatNickname" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inquiryId" TEXT,
    "addressId" TEXT,
    "email" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "subtotal" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentMethod" TEXT,
    "addressName" TEXT,
    "addressPhone" TEXT,
    "addressText" TEXT,
    "addressInstitution" TEXT,
    "shippingMethod" TEXT NOT NULL DEFAULT 'logistics',
    "logisticsCompany" TEXT,
    "logisticsNumber" TEXT,
    "selfPickupPoint" TEXT,
    "dedicatedContact" TEXT,
    "dedicatedPhone" TEXT,
    "operationLogs" TEXT NOT NULL DEFAULT '[]',
    "legalAcceptedIds" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "archivedAt" DATETIME,
    "quoteSent" BOOLEAN NOT NULL DEFAULT false,
    "quoteSentAt" DATETIME,
    CONSTRAINT "Order_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("addressId", "addressInstitution", "addressName", "addressPhone", "addressText", "archivedAt", "createdAt", "dedicatedContact", "dedicatedPhone", "email", "id", "inquiryId", "items", "logisticsCompany", "logisticsNumber", "operationLogs", "paymentMethod", "quoteSent", "quoteSentAt", "selfPickupPoint", "shippingMethod", "status", "subtotal", "updatedAt") SELECT "addressId", "addressInstitution", "addressName", "addressPhone", "addressText", "archivedAt", "createdAt", "dedicatedContact", "dedicatedPhone", "email", "id", "inquiryId", "items", "logisticsCompany", "logisticsNumber", "operationLogs", "paymentMethod", "quoteSent", "quoteSentAt", "selfPickupPoint", "shippingMethod", "status", "subtotal", "updatedAt" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE INDEX "Order_email_idx" ON "Order"("email");
CREATE INDEX "Order_inquiryId_idx" ON "Order"("inquiryId");
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "LegalDocument_published_idx" ON "LegalDocument"("published");
CREATE INDEX "LegalDocument_sortOrder_idx" ON "LegalDocument"("sortOrder");
