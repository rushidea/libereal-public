-- Coupon applicability scope. Existing rows stay site-wide via column defaults.
ALTER TABLE "Coupon" ADD COLUMN "scopeType" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "Coupon" ADD COLUMN "scopeTargets" TEXT NOT NULL DEFAULT '[]';
