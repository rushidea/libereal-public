-- Phase 1.5: add the canonical authenticator and recovery-code tables.
-- Existing MfaSetting/MfaRecoveryCode tables are intentionally retained for
-- application-level backfill, dual-read/dual-write, and rollback compatibility.

CREATE TABLE "user_authenticators" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "legacy_source_id" TEXT,
    "credential_data" TEXT,
    "credential_id" TEXT,
    "encrypted_secret" TEXT,
    "secret_iv" TEXT,
    "secret_auth_tag" TEXT,
    "key_version" INTEGER,
    "last_used_step" INTEGER,
    "confirmed_at" DATETIME,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_authenticators_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "recovery_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "authenticator_id" TEXT,
    "code_hash" TEXT NOT NULL,
    "pepper_version" INTEGER NOT NULL DEFAULT 1,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recovery_codes_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "recovery_codes_authenticator_id_fkey"
      FOREIGN KEY ("authenticator_id") REFERENCES "user_authenticators" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_authenticators_legacy_source_id_key"
ON "user_authenticators"("legacy_source_id");

CREATE UNIQUE INDEX "user_authenticators_credential_id_key"
ON "user_authenticators"("credential_id");

CREATE INDEX "user_authenticators_user_id_type_enabled_idx"
ON "user_authenticators"("user_id", "type", "enabled");

CREATE UNIQUE INDEX "recovery_codes_user_id_code_hash_key"
ON "recovery_codes"("user_id", "code_hash");

CREATE INDEX "recovery_codes_user_id_used_at_idx"
ON "recovery_codes"("user_id", "used_at");
