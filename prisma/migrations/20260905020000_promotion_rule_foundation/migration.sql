ALTER TABLE "Promotion" ADD COLUMN "ruleDefinition" TEXT;
ALTER TABLE "Promotion" ADD COLUMN "ruleVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PromotionProduct" ADD COLUMN "groupKey" TEXT NOT NULL DEFAULT 'main';
