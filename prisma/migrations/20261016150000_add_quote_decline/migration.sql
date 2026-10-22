-- Customer quote decline: reason, note, and actor. Additive columns only.
ALTER TABLE "Quote" ADD COLUMN "declineReasonCode" TEXT;
ALTER TABLE "Quote" ADD COLUMN "declineNote" TEXT;
ALTER TABLE "Quote" ADD COLUMN "declinedAt" DATETIME;
ALTER TABLE "Quote" ADD COLUMN "declinedByUserId" TEXT;
ALTER TABLE "Quote" ADD COLUMN "declinedByEmail" TEXT;
