-- Add structured lab/affiliation fields to User
-- These are locked after registration (cannot be edited from account settings)
ALTER TABLE "User" ADD COLUMN "school" TEXT;
ALTER TABLE "User" ADD COLUMN "college" TEXT;
ALTER TABLE "User" ADD COLUMN "major" TEXT;
ALTER TABLE "User" ADD COLUMN "building" TEXT;
ALTER TABLE "User" ADD COLUMN "piLab" TEXT;
ALTER TABLE "User" ADD COLUMN "affiliatedLab" TEXT;
