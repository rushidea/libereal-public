CREATE TABLE "Quote" (
    "id" TEXT NOT NULL PRIMARY KEY, "inquiryId" TEXT NOT NULL, "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft', "subtotal" REAL NOT NULL, "currency" TEXT NOT NULL DEFAULT 'CNY',
    "validUntil" DATETIME, "sentAt" DATETIME, "acceptedAt" DATETIME, "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Quote_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "QuoteItem" (
    "id" TEXT NOT NULL PRIMARY KEY, "quoteId" TEXT NOT NULL, "inquiryItemId" TEXT, "position" INTEGER NOT NULL,
    "productId" TEXT, "catalogNumber" TEXT, "name" TEXT NOT NULL, "unitPrice" REAL NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1, "orderedQty" INTEGER NOT NULL DEFAULT 0, "lineTotal" REAL NOT NULL,
    "leadTime" TEXT, "available" BOOLEAN NOT NULL DEFAULT true, "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteItem_inquiryItemId_fkey" FOREIGN KEY ("inquiryItemId") REFERENCES "InquiryItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "QuoteConfirmation" (
    "id" TEXT NOT NULL PRIMARY KEY, "quoteId" TEXT NOT NULL, "userId" TEXT, "email" TEXT NOT NULL,
    "action" TEXT NOT NULL, "details" TEXT, "ip" TEXT, "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteConfirmation_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Quote_inquiryId_version_key" ON "Quote"("inquiryId", "version");
CREATE INDEX "Quote_inquiryId_status_version_idx" ON "Quote"("inquiryId", "status", "version");
CREATE INDEX "Quote_validUntil_idx" ON "Quote"("validUntil");
CREATE UNIQUE INDEX "QuoteItem_quoteId_position_key" ON "QuoteItem"("quoteId", "position");
CREATE INDEX "QuoteItem_quoteId_idx" ON "QuoteItem"("quoteId");
CREATE INDEX "QuoteItem_inquiryItemId_idx" ON "QuoteItem"("inquiryItemId");
CREATE INDEX "QuoteItem_catalogNumber_idx" ON "QuoteItem"("catalogNumber");
CREATE INDEX "QuoteConfirmation_quoteId_createdAt_idx" ON "QuoteConfirmation"("quoteId", "createdAt");
CREATE INDEX "QuoteConfirmation_email_idx" ON "QuoteConfirmation"("email");
ALTER TABLE "Inquiry" DROP COLUMN "quoteSent";
ALTER TABLE "Inquiry" DROP COLUMN "quoteSentAt";
ALTER TABLE "Inquiry" DROP COLUMN "quoteConfirmed";
