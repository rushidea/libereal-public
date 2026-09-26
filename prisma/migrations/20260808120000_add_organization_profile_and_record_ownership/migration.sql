ALTER TABLE "organizations" ADD COLUMN "pending_name" TEXT;

ALTER TABLE "Inquiry" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "Inquiry" ADD COLUMN "owner_scope" TEXT NOT NULL DEFAULT 'personal';
CREATE INDEX "inquiries_organization_id_owner_scope_created_at_idx"
  ON "Inquiry" ("organization_id", "owner_scope", "createdAt");

ALTER TABLE "Order" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "Order" ADD COLUMN "owner_scope" TEXT NOT NULL DEFAULT 'personal';
CREATE INDEX "orders_organization_id_owner_scope_created_at_idx"
  ON "Order" ("organization_id", "owner_scope", "createdAt");

ALTER TABLE "UserCreatedRecipe" ADD COLUMN "owner_scope" TEXT NOT NULL DEFAULT 'personal';
ALTER TABLE "UserSavedBuffer" ADD COLUMN "owner_scope" TEXT NOT NULL DEFAULT 'personal';
