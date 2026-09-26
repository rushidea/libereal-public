-- Keep removed device history while allowing a later login to create a new
-- active record for the same user-agent fingerprint.
DROP INDEX IF EXISTS "user_devices_user_id_fingerprint_key";
DROP INDEX IF EXISTS "user_devices_user_id_fingerprint_active_key";
CREATE UNIQUE INDEX "user_devices_user_id_fingerprint_active_key"
ON "user_devices"("user_id", "fingerprint")
WHERE "revoked_at" IS NULL;
