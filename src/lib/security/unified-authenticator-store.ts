import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type AuthenticatorType = 'password' | 'totp' | 'passkey' | 'security_key';

export interface EncryptedEnvelopeParts {
  keyVersion: number;
  secretIv: string;
  encryptedSecret: string;
  secretAuthTag: string;
}

export interface LegacyMfaSettingRow {
  id: string;
  userId: string;
  enabled: number;
  required: number;
  method: string;
  encryptedSecret: string;
  secretVersion: number;
  lastUsedStep: number | null;
  confirmedAt: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackfillSummary {
  authenticatorsCreated: number;
  recoveryCodesCopied: number;
  skippedExisting: number;
  conflicts: number;
}

export function hasUnifiedTables(db: Database.Database): boolean {
  const rows = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('user_authenticators', 'recovery_codes')
  `).all() as Array<{ name: string }>;
  return rows.length === 2;
}

/**
 * Legacy envelope format: `<keyVersion>:<iv>:<ciphertext>:<authTag>`.
 * Split only in memory; never log or persist the plaintext secret.
 */
export function splitEncryptedEnvelope(envelope: string): EncryptedEnvelopeParts {
  const parts = envelope.split(':');
  if (parts.length !== 4) throw new Error('MFA_SECRET_FORMAT_INVALID');
  const version = Number(parts[0]);
  if (!Number.isInteger(version) || version < 1) throw new Error('MFA_SECRET_VERSION_INVALID');
  return { keyVersion: version, secretIv: parts[1], encryptedSecret: parts[2], secretAuthTag: parts[3] };
}

export function joinEncryptedEnvelope(parts: EncryptedEnvelopeParts): string {
  return `${parts.keyVersion}:${parts.secretIv}:${parts.encryptedSecret}:${parts.secretAuthTag}`;
}

function normalizeRecoveryHash(hash: string): string {
  return /^v\d+:([0-9a-f]{64})$/i.exec(hash)?.[1] ?? hash;
}

export function backfillAuthenticators(db: Database.Database): BackfillSummary {
  const summary: BackfillSummary = { authenticatorsCreated: 0, recoveryCodesCopied: 0, skippedExisting: 0, conflicts: 0 };
  if (!hasUnifiedTables(db)) return summary;

  const settings = db.prepare(`
    SELECT id, userId, enabled, required, method, encryptedSecret, secretVersion, lastUsedStep, confirmedAt, lastVerifiedAt, createdAt, updatedAt
    FROM MfaSetting
  `).all() as LegacyMfaSettingRow[];

  const findExisting = db.prepare(`
    SELECT id, user_id, type, enabled, required, encrypted_secret, secret_iv,
           secret_auth_tag, key_version, last_used_step, confirmed_at, last_used_at
    FROM user_authenticators
    WHERE legacy_source_id = ?
  `);
  const insertAuthenticator = db.prepare(`
    INSERT INTO user_authenticators
      (id, user_id, type, name, legacy_source_id, credential_data, credential_id,
       encrypted_secret, secret_iv, secret_auth_tag, key_version,
       last_used_step, confirmed_at, required, enabled, last_used_at, created_at, updated_at)
    VALUES (?, ?, 'totp', NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const findRecovery = db.prepare('SELECT codeHash, usedAt, createdAt FROM MfaRecoveryCode WHERE userId = ?');
  const recoveryExists = db.prepare(`
    SELECT id, authenticator_id, used_at
    FROM recovery_codes
    WHERE user_id = ? AND code_hash = ?
  `);
  const recoveryByUser = db.prepare(`
    SELECT id, code_hash, authenticator_id, used_at
    FROM recovery_codes
    WHERE user_id = ?
  `);
  const insertRecovery = db.prepare(`
    INSERT INTO recovery_codes (id, user_id, authenticator_id, code_hash, pepper_version, used_at, created_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `);

  for (const setting of settings) {
    let parts: EncryptedEnvelopeParts;
    try {
      parts = splitEncryptedEnvelope(setting.encryptedSecret);
    } catch {
      summary.conflicts += 1;
      continue;
    }
    const delta = { authenticatorsCreated: 0, recoveryCodesCopied: 0, skippedExisting: 0 };
    try {
      db.transaction(() => {
        const existing = findExisting.get(setting.id) as {
          id: string;
          user_id: string;
          type: string;
          enabled: number;
          required: number;
          encrypted_secret: string | null;
          secret_iv: string | null;
          secret_auth_tag: string | null;
          key_version: number | null;
          last_used_step: number | null;
          confirmed_at: string | null;
          last_used_at: string | null;
        } | undefined;
        let authenticatorId: string;
        if (existing) {
          const consistent = existing.user_id === setting.userId
            && existing.type === 'totp'
            && existing.enabled === setting.enabled
            && existing.required === setting.required
            && existing.encrypted_secret === parts.encryptedSecret
            && existing.secret_iv === parts.secretIv
            && existing.secret_auth_tag === parts.secretAuthTag
            && existing.key_version === parts.keyVersion
            && existing.last_used_step === setting.lastUsedStep
            && existing.confirmed_at === setting.confirmedAt
            && existing.last_used_at === setting.lastVerifiedAt;
          if (!consistent) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
          authenticatorId = existing.id;
          delta.skippedExisting += 1;
        } else {
          authenticatorId = randomUUID();
          insertAuthenticator.run(
            authenticatorId,
            setting.userId,
            setting.id,
            parts.encryptedSecret,
            parts.secretIv,
            parts.secretAuthTag,
            parts.keyVersion,
            setting.lastUsedStep,
            setting.confirmedAt,
            setting.required,
            setting.enabled,
            setting.lastVerifiedAt,
            setting.createdAt,
            setting.updatedAt,
          );
          delta.authenticatorsCreated += 1;
        }

        const recoveryRows = findRecovery.all(setting.userId) as Array<{ codeHash: string; usedAt: string | null; createdAt: string }>;
        const legacyHashes = new Set(recoveryRows.map((row) => normalizeRecoveryHash(row.codeHash)));
        for (const row of recoveryRows) {
          const normalizedMatches = (recoveryByUser.all(setting.userId) as Array<{
            id: string;
            code_hash: string;
            authenticator_id: string | null;
            used_at: string | null;
          }>).filter((candidate) => normalizeRecoveryHash(candidate.code_hash) === normalizeRecoveryHash(row.codeHash));
          if (normalizedMatches.length > 1) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
          const existingRecovery = (recoveryExists.get(setting.userId, row.codeHash) as {
            id: string;
            authenticator_id: string | null;
            used_at: string | null;
          } | undefined) ?? normalizedMatches[0];
          if (existingRecovery) {
            if (
              existingRecovery.used_at !== row.usedAt ||
              (existingRecovery.authenticator_id !== null && existingRecovery.authenticator_id !== authenticatorId)
            ) {
              throw new Error('AUTHENTICATOR_DATA_CONFLICT');
            }
            if (existingRecovery.authenticator_id === null) {
              db.prepare('UPDATE recovery_codes SET authenticator_id = ? WHERE id = ?').run(authenticatorId, existingRecovery.id);
            }
            continue;
          }
          insertRecovery.run(randomUUID(), setting.userId, authenticatorId, row.codeHash, row.usedAt, row.createdAt);
          delta.recoveryCodesCopied += 1;
        }
        for (const extra of recoveryByUser.all(setting.userId) as Array<{ code_hash: string }>) {
          if (!legacyHashes.has(normalizeRecoveryHash(extra.code_hash))) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
        }
      })();
      summary.authenticatorsCreated += delta.authenticatorsCreated;
      summary.recoveryCodesCopied += delta.recoveryCodesCopied;
      summary.skippedExisting += delta.skippedExisting;
    } catch (error) {
      if (error instanceof Error && error.message === 'AUTHENTICATOR_DATA_CONFLICT') summary.conflicts += 1;
      else throw error;
    }
  }
  return summary;
}

export function writePendingTotpAuthenticator(
  db: Database.Database,
  input: { legacySourceId: string; userId: string; encryptedSecret: string; keyVersion: number; nowIso: string },
): string {
  const parts = splitEncryptedEnvelope(input.encryptedSecret);
  const existing = db.prepare('SELECT id, user_id FROM user_authenticators WHERE legacy_source_id = ?').get(input.legacySourceId) as { id: string; user_id: string } | undefined;
  if (existing) {
    if (existing.user_id !== input.userId) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
    db.prepare(`
      UPDATE user_authenticators
      SET encrypted_secret = ?, secret_iv = ?, secret_auth_tag = ?, key_version = ?,
          last_used_step = NULL, confirmed_at = NULL, required = 0, enabled = 0,
          last_used_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(parts.encryptedSecret, parts.secretIv, parts.secretAuthTag, parts.keyVersion, input.nowIso, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare(`
    INSERT INTO user_authenticators
      (id, user_id, type, name, legacy_source_id, credential_data, credential_id,
       encrypted_secret, secret_iv, secret_auth_tag, key_version,
       last_used_step, confirmed_at, required, enabled, last_used_at, created_at, updated_at)
    VALUES (?, ?, 'totp', NULL, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, 0, 0, NULL, ?, ?)
  `).run(
    id,
    input.userId,
    input.legacySourceId,
    parts.encryptedSecret,
    parts.secretIv,
    parts.secretAuthTag,
    parts.keyVersion,
    input.nowIso,
    input.nowIso,
  );
  return id;
}

export function enableTotpAuthenticator(
  db: Database.Database,
  input: { legacySourceId: string; confirmedAt: string; nowIso: string },
): string | null {
  const result = db.prepare(`
    UPDATE user_authenticators
    SET enabled = 1, confirmed_at = ?, updated_at = ?
    WHERE legacy_source_id = ? AND type = 'totp' AND enabled = 0
  `).run(input.confirmedAt, input.nowIso, input.legacySourceId);
  if (result.changes !== 1) return null;
  const row = db.prepare('SELECT id FROM user_authenticators WHERE legacy_source_id = ?').get(input.legacySourceId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function disableTotpAuthenticators(db: Database.Database, userId: string, nowIso: string): void {
  db.prepare(`
    UPDATE user_authenticators SET enabled = 0, last_used_step = NULL, last_used_at = NULL, updated_at = ?
    WHERE user_id = ? AND type = 'totp'
  `).run(nowIso, userId);
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
}

export function syncRecoveryCodes(
  db: Database.Database,
  input: { userId: string; authenticatorId: string | null; codeHashes: string[]; pepperVersion?: number; nowIso: string },
): void {
  db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(input.userId);
  const insert = db.prepare(`
    INSERT INTO recovery_codes (id, user_id, authenticator_id, code_hash, pepper_version, used_at, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `);
  for (const codeHash of input.codeHashes) {
    insert.run(randomUUID(), input.userId, input.authenticatorId, codeHash, input.pepperVersion ?? 1, input.nowIso);
  }
}

export function findEnabledTotpSecret(db: Database.Database, userId: string): EncryptedEnvelopeParts | null {
  const count = db.prepare(`
    SELECT COUNT(*) AS count FROM user_authenticators
    WHERE user_id = ? AND type = 'totp' AND enabled = 1
  `).get(userId) as { count: number };
  if (count.count > 1) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
  const row = db.prepare(`
    SELECT encrypted_secret, secret_iv, secret_auth_tag, key_version
    FROM user_authenticators
    WHERE user_id = ? AND type = 'totp' AND enabled = 1
    ORDER BY created_at ASC
    LIMIT 1
  `).get(userId) as { encrypted_secret: string; secret_iv: string; secret_auth_tag: string; key_version: number } | undefined;
  if (!row) return null;
  return {
    keyVersion: row.key_version,
    secretIv: row.secret_iv,
    encryptedSecret: row.encrypted_secret,
    secretAuthTag: row.secret_auth_tag,
  };
}

export function readUnifiedMfaStatus(db: Database.Database, userId: string): {
  enabled: boolean;
  confirmedAt: string | null;
  lastUsedAt: string | null;
  lastUsedStep: number | null;
} | null {
  const row = db.prepare(`
    SELECT enabled, confirmed_at, last_used_at, last_used_step
    FROM user_authenticators
    WHERE user_id = ? AND type = 'totp'
    ORDER BY created_at ASC
    LIMIT 1
  `).get(userId) as { enabled: number; confirmed_at: string | null; last_used_at: string | null; last_used_step: number | null } | undefined;
  if (!row) return null;
  return { enabled: row.enabled === 1, confirmedAt: row.confirmed_at, lastUsedAt: row.last_used_at, lastUsedStep: row.last_used_step };
}

export function hasEnabledUnifiedAuthenticator(db: Database.Database, userId: string): boolean {
  if (!hasUnifiedTables(db)) return false;
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM user_authenticators
    WHERE user_id = ? AND type IN ('totp', 'passkey', 'security_key') AND enabled = 1
  `).get(userId) as { count: number };
  return row.count > 0;
}

export function readLegacyMfaStatus(db: Database.Database, userId: string): {
  enabled: boolean;
  confirmedAt: string | null;
  lastUsedAt: string | null;
} | null {
  const row = db.prepare(`
    SELECT enabled, confirmedAt, lastVerifiedAt
    FROM MfaSetting
    WHERE userId = ?
  `).get(userId) as { enabled: number; confirmedAt: string | null; lastVerifiedAt: string | null } | undefined;
  if (!row) return null;
  return { enabled: row.enabled === 1, confirmedAt: row.confirmedAt, lastUsedAt: row.lastVerifiedAt };
}

/**
 * During the compatibility window both representations must agree. A
 * mismatch is a security condition, not a reason to silently prefer one
 * table, because doing so could bypass a disable or replay marker.
 */
export function assertUnifiedMfaStatusConsistency(db: Database.Database, userId: string): void {
  if (!hasUnifiedTables(db)) return;
  const totpCount = db.prepare(`
    SELECT COUNT(*) AS count FROM user_authenticators
    WHERE user_id = ? AND type = 'totp'
  `).get(userId) as { count: number };
  if (totpCount.count > 1) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
  const legacy = readLegacyMfaStatus(db, userId);
  const unified = readUnifiedMfaStatus(db, userId);
  if (!legacy || !unified) {
    const active = legacy ? legacy.enabled || !!legacy.confirmedAt || !!legacy.lastUsedAt : unified?.enabled || !!unified?.confirmedAt || !!unified?.lastUsedAt;
    if (active) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
    return;
  }
  if (
    legacy.enabled !== unified.enabled ||
    legacy.confirmedAt !== unified.confirmedAt ||
    legacy.lastUsedAt !== unified.lastUsedAt
  ) {
    throw new Error('AUTHENTICATOR_DATA_CONFLICT');
  }
  const legacyStep = db.prepare('SELECT lastUsedStep FROM MfaSetting WHERE userId = ?').get(userId) as { lastUsedStep: number | null } | undefined;
  if (!legacyStep || legacyStep.lastUsedStep !== unified.lastUsedStep) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
}

export function readUnifiedLastUsedStep(db: Database.Database, userId: string): number | null {
  const row = db.prepare(`
    SELECT last_used_step FROM user_authenticators
    WHERE user_id = ? AND type = 'totp' AND enabled = 1
    ORDER BY created_at ASC LIMIT 1
  `).get(userId) as { last_used_step: number | null } | undefined;
  return row?.last_used_step ?? null;
}

export function readUnifiedLastUsedStepState(db: Database.Database, userId: string): { found: boolean; lastUsedStep: number | null; lastUsedAt: string | null } {
  const row = db.prepare(`
    SELECT last_used_step, last_used_at FROM user_authenticators
    WHERE user_id = ? AND type = 'totp' AND enabled = 1
    ORDER BY created_at ASC LIMIT 1
  `).get(userId) as { last_used_step: number | null; last_used_at: string | null } | undefined;
  return { found: Boolean(row), lastUsedStep: row?.last_used_step ?? null, lastUsedAt: row?.last_used_at ?? null };
}

export function advanceUnifiedLastUsedStep(
  db: Database.Database,
  userId: string,
  matchedStep: number,
  nowIso: string,
): boolean {
  const result = db.prepare(`
    UPDATE user_authenticators
    SET last_used_step = ?, last_used_at = ?, updated_at = ?
    WHERE user_id = ? AND type = 'totp' AND enabled = 1
      AND (last_used_step IS NULL OR last_used_step < ?)
  `).run(matchedStep, nowIso, nowIso, userId, matchedStep);
  return result.changes === 1;
}

export function updateUnifiedLastVerifiedAt(db: Database.Database, userId: string, nowIso: string): boolean {
  const result = db.prepare(`
    UPDATE user_authenticators SET last_used_at = ?, updated_at = ?
    WHERE user_id = ? AND type = 'totp' AND enabled = 1
  `).run(nowIso, nowIso, userId);
  return result.changes === 1;
}

export function consumeUnifiedRecoveryCode(db: Database.Database, userId: string, codeHashes: string[], nowIso: string): boolean {
  for (const codeHash of codeHashes) {
    const result = db.prepare(`
      UPDATE recovery_codes SET used_at = ?
      WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
    `).run(nowIso, userId, codeHash);
    if (result.changes === 1) return true;
  }
  return false;
}

export interface UnifiedConsistencyReport {
  ok: boolean;
  errors: string[];
  checkedAuthenticators: number;
  checkedRecoveryCodes: number;
}

/**
 * Verifies that unified rows mirror their legacy source rows: user, envelope
 * parts, lastUsedStep, enabled/confirmed state, and recovery-code hashes.
 * Used by the isolated migration drill and by tests.
 */
export function verifyUnifiedConsistency(db: Database.Database): UnifiedConsistencyReport {
  const report: UnifiedConsistencyReport = { ok: true, errors: [], checkedAuthenticators: 0, checkedRecoveryCodes: 0 };
  if (!hasUnifiedTables(db)) {
    report.errors.push('unified_tables_missing');
    report.ok = false;
    return report;
  }

  const settings = db.prepare(`
    SELECT id, userId, enabled, required, encryptedSecret, secretVersion, lastUsedStep, confirmedAt, lastVerifiedAt
    FROM MfaSetting
  `).all() as Array<{
    id: string;
    userId: string;
    enabled: number;
    required: number;
    encryptedSecret: string;
    secretVersion: number;
    lastUsedStep: number | null;
    confirmedAt: string | null;
    lastVerifiedAt: string | null;
  }>;
  const getAuthenticator = db.prepare(`
    SELECT user_id, enabled, required, encrypted_secret, secret_iv, secret_auth_tag, key_version, last_used_step, confirmed_at, last_used_at
    FROM user_authenticators WHERE legacy_source_id = ?
  `);

  for (const setting of settings) {
    const authenticator = getAuthenticator.get(setting.id) as {
      user_id: string;
      enabled: number;
      required: number;
      encrypted_secret: string;
      secret_iv: string;
      secret_auth_tag: string;
      key_version: number;
      last_used_step: number | null;
      confirmed_at: string | null;
      last_used_at: string | null;
    } | undefined;
    if (!authenticator) {
      report.errors.push(`missing_authenticator:${setting.id}`);
      report.ok = false;
      continue;
    }
    report.checkedAuthenticators += 1;
    if (authenticator.user_id !== setting.userId) report.errors.push(`user_mismatch:${setting.id}`);
    if (authenticator.enabled !== setting.enabled) report.errors.push(`enabled_mismatch:${setting.id}`);
    if (authenticator.required !== setting.required) report.errors.push(`required_mismatch:${setting.id}`);
    if (authenticator.key_version !== setting.secretVersion) report.errors.push(`key_version_mismatch:${setting.id}`);
    if (authenticator.last_used_step !== setting.lastUsedStep) report.errors.push(`last_used_step_mismatch:${setting.id}`);
    if (authenticator.confirmed_at !== setting.confirmedAt) report.errors.push(`confirmed_at_mismatch:${setting.id}`);
    if (authenticator.last_used_at !== setting.lastVerifiedAt) report.errors.push(`last_used_at_mismatch:${setting.id}`);
    const parts = splitEncryptedEnvelope(setting.encryptedSecret);
    if (
      authenticator.encrypted_secret !== parts.encryptedSecret ||
      authenticator.secret_iv !== parts.secretIv ||
      authenticator.secret_auth_tag !== parts.secretAuthTag
    ) {
      report.errors.push(`envelope_mismatch:${setting.id}`);
    }
  }

  const recoveryRows = db.prepare('SELECT userId, codeHash, usedAt FROM MfaRecoveryCode').all() as Array<{ userId: string; codeHash: string; usedAt: string | null }>;
  const unifiedRecoveryRows = db.prepare('SELECT user_id, code_hash, used_at FROM recovery_codes').all() as Array<{ user_id: string; code_hash: string; used_at: string | null }>;
  for (const row of recoveryRows) {
    report.checkedRecoveryCodes += 1;
    const matches = unifiedRecoveryRows.filter((candidate) => candidate.user_id === row.userId && normalizeRecoveryHash(candidate.code_hash) === normalizeRecoveryHash(row.codeHash));
    if (matches.length !== 1) {
      report.errors.push(`missing_recovery:${row.userId}:${row.codeHash}`);
      report.ok = false;
      continue;
    }
    if (matches[0].used_at !== row.usedAt) report.errors.push(`recovery_used_mismatch:${row.userId}:${row.codeHash}`);
  }

  for (const row of unifiedRecoveryRows) {
    const exists = recoveryRows.find((legacy) => legacy.userId === row.user_id && normalizeRecoveryHash(legacy.codeHash) === normalizeRecoveryHash(row.code_hash));
    if (!exists) report.errors.push(`extra_recovery:${row.user_id}:${row.code_hash}`);
  }

  if (report.errors.length > 0) report.ok = false;
  return report;
}
