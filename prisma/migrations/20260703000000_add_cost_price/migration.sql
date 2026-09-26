-- AlterTable
-- Add costPrice column to Product (进货价, admin only, never exposed to frontend APIs)
ALTER TABLE "Product" ADD COLUMN "costPrice" REAL;
