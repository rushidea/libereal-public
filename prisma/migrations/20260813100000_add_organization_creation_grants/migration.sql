CREATE TABLE "organization_creation_grants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "granted_by_user_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_creation_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "organization_creation_grants_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "organization_creation_grants_user_id_key" ON "organization_creation_grants"("user_id");
CREATE INDEX "organization_creation_grants_granted_by_user_id_idx" ON "organization_creation_grants"("granted_by_user_id");
