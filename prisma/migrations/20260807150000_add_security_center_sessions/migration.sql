-- Phase 2: Security Center session and device records.
CREATE TABLE "user_devices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "name" TEXT,
    "browser" TEXT,
    "operating_system" TEXT,
    "ip" TEXT,
    "last_seen_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" DATETIME,
    CONSTRAINT "user_devices_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "device_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" DATETIME NOT NULL,
    "expires_at" DATETIME,
    "revoked_at" DATETIME,
    CONSTRAINT "user_sessions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_sessions_device_id_fkey"
      FOREIGN KEY ("device_id") REFERENCES "user_devices" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_devices_user_id_fingerprint_active_key"
ON "user_devices"("user_id", "fingerprint")
WHERE "revoked_at" IS NULL;
CREATE INDEX "user_devices_user_id_revoked_at_idx"
ON "user_devices"("user_id", "revoked_at");
CREATE UNIQUE INDEX "user_sessions_session_id_key"
ON "user_sessions"("session_id");
CREATE INDEX "user_sessions_user_id_revoked_at_last_seen_at_idx"
ON "user_sessions"("user_id", "revoked_at", "last_seen_at");
CREATE INDEX "user_sessions_device_id_idx"
ON "user_sessions"("device_id");
