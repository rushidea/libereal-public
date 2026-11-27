-- CreateTable
CREATE TABLE "InquiryFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inquiryId" TEXT NOT NULL,
    "quoteId" TEXT,
    "quoteVersion" INTEGER,
    "actorType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "actorName" TEXT,
    "channel" TEXT NOT NULL,
    "channelReference" TEXT,
    "feedbackType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "handlingStatus" TEXT NOT NULL DEFAULT 'pending',
    "handledByAdminId" TEXT,
    "handledByAdminEmail" TEXT,
    "handledAt" DATETIME,
    "resolutionNote" TEXT,
    "resolvedByQuoteId" TEXT,
    "clientRequestId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InquiryFeedback_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InquiryFeedback_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InquiryFeedback_inquiryId_clientRequestId_key" ON "InquiryFeedback"("inquiryId", "clientRequestId");

-- CreateIndex
CREATE INDEX "InquiryFeedback_inquiryId_createdAt_idx" ON "InquiryFeedback"("inquiryId", "createdAt");

-- CreateIndex
CREATE INDEX "InquiryFeedback_inquiryId_handlingStatus_idx" ON "InquiryFeedback"("inquiryId", "handlingStatus");

-- CreateIndex
CREATE INDEX "InquiryFeedback_quoteId_idx" ON "InquiryFeedback"("quoteId");
