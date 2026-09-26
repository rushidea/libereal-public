import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getDatabasePath } from '@/lib/databasePath';
import {
  consumeMfaChallenge,
  consumeMfaRecoveryChallenge,
  createMfaChallenge,
  hashChallengeForStorage,
  recordMfaFailure,
  type MfaChallengeProvider,
} from './mfa-challenge-store';
import { decryptMfaSecret, encryptMfaSecret, hashMfaRecoveryCode, hashMfaRecoveryCodeWithVersion, loadMfaKeyRing, loadMfaRecoveryPepperRing } from './mfa-crypto';
import { isMfaPhase1Enabled, MFA_CHALLENGE_TTL_MS } from './mfa-config';
import { buildTotpUri, findTotpStep, generateTotpSecret } from './mfa-totp';
import { recordSecurityEvent } from './security-events';
import {
  disableTotpAuthenticators,
  enableTotpAuthenticator,
  assertUnifiedMfaStatusConsistency,
  findEnabledTotpSecret,
  hasEnabledUnifiedAuthenticator,
  hasUnifiedTables,
  joinEncryptedEnvelope,
  readUnifiedMfaStatus,
  syncRecoveryCodes,
  updateUnifiedLastVerifiedAt,
  writePendingTotpAuthenticator,
} from './unified-authenticator-store';
import {
  enforceMfaChallengeCreationRateLimits,
  enforceMfaRateLimits,
  type MfaRateLimitStore,
} from './mfa-rate-limit';

export interface MfaLoginChallenge {
  id: string;
  token: string;
  provider: MfaChallengeProvider;
}

export interface MfaSetupResult {
  secret: string;
  otpauthUrl: string;
}

export interface MfaStatus {
  enabled: boolean;
  confirmedAt: string | null;
  lastVerifiedAt: string | null;
  passkeyEnabled: boolean;
}

export interface VerifiedMfaLogin {
  userId: string;
  email: string;
  name: string | null;
  mfaMethod: 'totp' | 'recovery';
  mfaVerifiedAt: number;
}

export type MfaStepUpVerification =
  | { ok: true; verifiedAt: number }
  | { ok: false; reason: string; clearCookie: boolean };

type UserRow = { id: string; email: string; name: string | null };
type SettingRow = { encryptedSecret: string; enabled: number; secretVersion: number };

function createRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => randomBytes(8).toString('hex').toUpperCase());
}

let mfaRateLimitStoreForTests: MfaRateLimitStore | null = null;

export function setMfaRateLimitStoreForTests(store: MfaRateLimitStore | null): void {
  mfaRateLimitStoreForTests = store;
}

function rateLimitStore(): MfaRateLimitStore | undefined {
  return mfaRateLimitStoreForTests ?? undefined;
}

function withDatabase<T>(callback: (db: Database.Database) => T): T {
  const db = new Database(getDatabasePath());
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function readOnlyDatabase<T>(callback: (db: Database.Database) => T): T {
  const db = new Database(getDatabasePath(), { readonly: true });
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

export function isUserMfaEnabled(userId: string): boolean {
  if (!isMfaPhase1Enabled()) return false;
  return readOnlyDatabase((db) => {
    if (hasUnifiedTables(db)) {
      assertUnifiedMfaStatusConsistency(db, userId);
      if (hasEnabledUnifiedAuthenticator(db, userId)) return true;
      const unified = readUnifiedMfaStatus(db, userId);
      if (unified) return unified.enabled;
    }
    const row = db.prepare('SELECT enabled FROM MfaSetting WHERE userId = ?').get(userId) as { enabled: number } | undefined;
    return row?.enabled === 1;
  });
}

export function getMfaAuthenticatorPresence(userId: string): { hasTotp: boolean; hasPasskey: boolean } {
  return readOnlyDatabase((db) => {
    if (hasUnifiedTables(db)) {
      const rows = db.prepare(`
        SELECT type FROM user_authenticators
        WHERE user_id = ? AND enabled = 1 AND type IN ('totp', 'passkey', 'security_key')
      `).all(userId) as Array<{ type: string }>;
      return {
        hasTotp: rows.some((row) => row.type === 'totp'),
        hasPasskey: rows.some((row) => row.type === 'passkey' || row.type === 'security_key'),
      };
    }
    const row = db.prepare('SELECT enabled FROM MfaSetting WHERE userId = ?').get(userId) as { enabled: number } | undefined;
    return { hasTotp: row?.enabled === 1, hasPasskey: false };
  });
}

export function getMfaStatus(userId: string): MfaStatus {
  return readOnlyDatabase((db) => {
    if (hasUnifiedTables(db)) {
      assertUnifiedMfaStatusConsistency(db, userId);
      const unified = readUnifiedMfaStatus(db, userId);
      const passkeyEnabled = db.prepare(`
        SELECT 1 FROM user_authenticators
        WHERE user_id = ? AND type = 'passkey' AND enabled = 1
        LIMIT 1
      `).get(userId) !== undefined;
      if (unified) {
        return {
          enabled: unified.enabled,
          confirmedAt: unified.confirmedAt,
          lastVerifiedAt: unified.lastUsedAt,
          passkeyEnabled,
        };
      }
      if (passkeyEnabled) return { enabled: false, confirmedAt: null, lastVerifiedAt: null, passkeyEnabled: true };
    }
    const row = db.prepare(`
      SELECT enabled, confirmedAt, lastVerifiedAt
      FROM MfaSetting
      WHERE userId = ?
    `).get(userId) as {
      enabled: number;
      confirmedAt: string | null;
      lastVerifiedAt: string | null;
    } | undefined;
    return {
      enabled: row?.enabled === 1,
      confirmedAt: row?.confirmedAt ?? null,
      lastVerifiedAt: row?.lastVerifiedAt ?? null,
      passkeyEnabled: false,
    };
  });
}

export async function createMfaLoginChallenge(
  userId: string,
  provider: MfaChallengeProvider,
  ip?: string | null,
): Promise<MfaLoginChallenge> {
  const rateLimit = await enforceMfaChallengeCreationRateLimits({
    store: rateLimitStore(),
    userId,
    provider,
    ip,
  });
  if (!rateLimit.allowed) throw new Error('MFA_CHALLENGE_RATE_LIMITED');

  return withDatabase((db) => {
    const challenge = createMfaChallenge(db, {
      userId,
      purpose: 'login',
      provider,
      ttlMs: MFA_CHALLENGE_TTL_MS,
    });
    return { id: challenge.id, token: challenge.token, provider };
  });
}

export async function createMfaStepUpChallenge(userId: string, ip?: string | null): Promise<MfaLoginChallenge & { expiresAt: Date }> {
  if (!isMfaPhase1Enabled()) throw new Error('MFA_DISABLED');
  if (!getMfaAuthenticatorPresence(userId).hasTotp) throw new Error('MFA_TOTP_NOT_ENABLED');

  const rateLimit = await enforceMfaChallengeCreationRateLimits({
    store: rateLimitStore(),
    userId,
    provider: 'credentials',
    ip,
  });
  if (!rateLimit.allowed) throw new Error('MFA_CHALLENGE_RATE_LIMITED');

  return withDatabase((db) => {
    const challenge = createMfaChallenge(db, {
      userId,
      purpose: 'sensitive_action',
      provider: 'credentials',
      ttlMs: MFA_CHALLENGE_TTL_MS,
    });
    return { ...challenge, provider: 'credentials' as const };
  });
}

export function createMfaSetup(userId: string): MfaSetupResult {
  const secret = generateTotpSecret();
  const keyRing = loadMfaKeyRing();
  const encryptedSecret = encryptMfaSecret(secret, keyRing);

  return withDatabase((db) => {
    const user = db.prepare('SELECT email FROM User WHERE id = ?').get(userId) as { email: string } | undefined;
    if (!user) throw new Error('USER_NOT_FOUND');
    const existing = db.prepare('SELECT enabled FROM MfaSetting WHERE userId = ?').get(userId) as { enabled: number } | undefined;
    if (existing?.enabled === 1) throw new Error('MFA_ALREADY_ENABLED');

    const now = new Date().toISOString();
    const run = db.transaction(() => {
      const settingId = randomUUID();
      db.prepare(`
        INSERT INTO MfaSetting
          (id, userId, enabled, required, method, encryptedSecret, secretVersion, lastUsedStep, confirmedAt, lastVerifiedAt, createdAt, updatedAt)
        VALUES (?, ?, 0, 0, 'totp', ?, ?, NULL, NULL, NULL, ?, ?)
        ON CONFLICT(userId) DO UPDATE SET
          enabled = 0,
          encryptedSecret = excluded.encryptedSecret,
          secretVersion = excluded.secretVersion,
          lastUsedStep = NULL,
          confirmedAt = NULL,
          lastVerifiedAt = NULL,
          updatedAt = excluded.updatedAt
      `).run(
        settingId,
        userId,
        encryptedSecret,
        keyRing.currentVersion,
        now,
        now,
      );
      if (hasUnifiedTables(db)) {
        const persistedSetting = db.prepare('SELECT id FROM MfaSetting WHERE userId = ?').get(userId) as { id: string } | undefined;
        if (!persistedSetting) throw new Error('MFA_SETTING_PERSISTENCE_FAILED');
        writePendingTotpAuthenticator(db, {
          legacySourceId: persistedSetting.id,
          userId,
          encryptedSecret,
          keyVersion: keyRing.currentVersion,
          nowIso: now,
        });
      }
    });
    run();

    return {
      secret,
      otpauthUrl: buildTotpUri(secret, user.email),
    };
  });
}

export async function verifyMfaSetupPassword(userId: string, password: string): Promise<boolean> {
  if (!password) return false;
  const db = new Database(getDatabasePath(), { readonly: true });
  try {
    const row = db.prepare('SELECT password FROM User WHERE id = ?').get(userId) as { password: string | null } | undefined;
    if (!row?.password) return false;
    return bcrypt.compare(password, row.password);
  } finally {
    db.close();
  }
}

export async function confirmMfaSetup(
  userId: string,
  code: string,
  ip?: string | null,
): Promise<{ recoveryCodes: string[] }> {
  const rateLimit = await enforceMfaRateLimits({
    store: rateLimitStore(),
    userId,
    provider: 'setup',
    setup: true,
    ip,
  });
  if (!rateLimit.allowed) throw new Error('MFA_SETUP_RATE_LIMITED');

  const now = new Date();
  const keyRing = loadMfaKeyRing();
  const pepperRing = loadMfaRecoveryPepperRing();
  const pepper = pepperRing.peppers.get(pepperRing.currentVersion);
  if (!pepper) throw new Error('MFA_RECOVERY_PEPPER_MISSING');

  return withDatabase((db) => {
    const setting = db.prepare(`
      SELECT encryptedSecret, enabled, secretVersion
      FROM MfaSetting
      WHERE userId = ?
    `).get(userId) as SettingRow | undefined;
    if (!setting) throw new Error('MFA_SETUP_NOT_STARTED');
    if (setting.enabled === 1) throw new Error('MFA_ALREADY_ENABLED');

    const secret = decryptMfaSecret(setting.encryptedSecret, keyRing);
    const matchedStep = findTotpStep(secret, code, now.getTime());
    if (matchedStep === null) throw new Error('MFA_CODE_INVALID');

    const recoveryCodes = createRecoveryCodes();
    const run = db.transaction(() => {
      const unified = hasUnifiedTables(db);
      const updated = db.prepare(`
        UPDATE MfaSetting
        SET enabled = 1, confirmedAt = ?, lastVerifiedAt = ?, lastUsedStep = NULL, updatedAt = ?
        WHERE userId = ? AND enabled = 0
      `).run(now.toISOString(), now.toISOString(), now.toISOString(), userId);
      if (updated.changes !== 1) throw new Error('MFA_CONFIRM_CONFLICT');

      db.prepare('DELETE FROM MfaRecoveryCode WHERE userId = ?').run(userId);
      const insert = db.prepare(`
        INSERT INTO MfaRecoveryCode (id, userId, codeHash, usedAt, createdAt)
        VALUES (?, ?, ?, NULL, ?)
      `);
      for (const recoveryCode of recoveryCodes) {
        insert.run(randomUUID(), userId, hashMfaRecoveryCode(recoveryCode, pepper), now.toISOString());
      }
      let authenticatorId: string | null = null;
      if (unified) {
        const legacySetting = db.prepare('SELECT id, encryptedSecret, secretVersion FROM MfaSetting WHERE userId = ?').get(userId) as { id: string; encryptedSecret: string; secretVersion: number } | undefined;
        if (legacySetting) {
          const unifiedSetting = db.prepare('SELECT id FROM user_authenticators WHERE legacy_source_id = ?').get(legacySetting.id) as { id: string } | undefined;
          if (!unifiedSetting) {
            writePendingTotpAuthenticator(db, {
              legacySourceId: legacySetting.id,
              userId,
              encryptedSecret: legacySetting.encryptedSecret,
              keyVersion: legacySetting.secretVersion,
              nowIso: now.toISOString(),
            });
          }
          authenticatorId = enableTotpAuthenticator(db, {
            legacySourceId: legacySetting.id,
            confirmedAt: now.toISOString(),
            nowIso: now.toISOString(),
          });
          if (!authenticatorId) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
          if (!updateUnifiedLastVerifiedAt(db, userId, now.toISOString())) {
            throw new Error('AUTHENTICATOR_DATA_CONFLICT');
          }
          syncRecoveryCodes(db, {
            userId,
            authenticatorId,
            codeHashes: recoveryCodes.map((recoveryCode) => hashMfaRecoveryCode(recoveryCode, pepper)),
            pepperVersion: pepperRing.currentVersion,
            nowIso: now.toISOString(),
          });
        }
      }
      recordSecurityEvent(db, {
        userId,
        eventType: 'MFA_ENABLED',
        ip,
        metadata: { method: 'totp', provider: 'setup', authenticatorId: authenticatorId ?? '' },
      });
    });
    run();
    return { recoveryCodes };
  });
}

export function disableMfa(userId: string, ip?: string | null): void {
  return withDatabase((db) => {
    const now = new Date().toISOString();
    const run = db.transaction(() => {
      const unified = hasUnifiedTables(db);
      const setting = db.prepare('SELECT enabled FROM MfaSetting WHERE userId = ?').get(userId) as { enabled: number } | undefined;
      if (!setting || setting.enabled !== 1) throw new Error('MFA_NOT_ENABLED');
      if (unified) {
        const otherAuthenticator = db.prepare(`
          SELECT 1 FROM user_authenticators
          WHERE user_id = ? AND type IN ('passkey', 'security_key') AND enabled = 1
          LIMIT 1
        `).get(userId);
        if (!otherAuthenticator) throw new Error('MFA_OTHER_AUTHENTICATOR_REQUIRED');
      }

      db.prepare(`
        UPDATE MfaSetting
        SET enabled = 0, required = 0, lastUsedStep = NULL, lastVerifiedAt = NULL, updatedAt = ?
        WHERE userId = ? AND enabled = 1
      `).run(now, userId);
      db.prepare('DELETE FROM MfaRecoveryCode WHERE userId = ?').run(userId);
      if (unified) disableTotpAuthenticators(db, userId, now);
      recordSecurityEvent(db, { userId, eventType: 'MFA_DISABLED', ip, metadata: { method: 'totp' } });
    });
    run();
  });
}

export function regenerateMfaRecoveryCodes(userId: string, ip?: string | null): { recoveryCodes: string[] } {
  const pepperRing = loadMfaRecoveryPepperRing();
  const pepper = pepperRing.peppers.get(pepperRing.currentVersion);
  if (!pepper) throw new Error('MFA_RECOVERY_PEPPER_MISSING');
  const recoveryCodes = createRecoveryCodes();

  return withDatabase((db) => {
    const now = new Date().toISOString();
    const run = db.transaction(() => {
      const unified = hasUnifiedTables(db);
      const setting = db.prepare('SELECT enabled FROM MfaSetting WHERE userId = ?').get(userId) as { enabled: number } | undefined;
      if (!setting || setting.enabled !== 1) throw new Error('MFA_NOT_ENABLED');

      db.prepare('DELETE FROM MfaRecoveryCode WHERE userId = ?').run(userId);
      const insert = db.prepare(`
        INSERT INTO MfaRecoveryCode (id, userId, codeHash, usedAt, createdAt)
        VALUES (?, ?, ?, NULL, ?)
      `);
      for (const recoveryCode of recoveryCodes) {
        insert.run(randomUUID(), userId, hashMfaRecoveryCode(recoveryCode, pepper), now);
      }
      db.prepare('UPDATE MfaSetting SET updatedAt = ? WHERE userId = ? AND enabled = 1').run(now, userId);
      if (unified) {
        const authenticator = db.prepare(`
          SELECT id FROM user_authenticators
          WHERE user_id = ? AND type = 'totp' AND enabled = 1
          ORDER BY created_at ASC LIMIT 1
        `).get(userId) as { id: string } | undefined;
        if (!authenticator) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
        syncRecoveryCodes(db, {
          userId,
          authenticatorId: authenticator.id,
          codeHashes: recoveryCodes.map((recoveryCode) => hashMfaRecoveryCode(recoveryCode, pepper)),
          pepperVersion: pepperRing.currentVersion,
          nowIso: now,
        });
      }
      recordSecurityEvent(db, { userId, eventType: 'RECOVERY_CODES_REGENERATED', ip });
    });
    run();
    return { recoveryCodes };
  });
}

function getMfaChallengeContext(db: Database.Database, challengeId: string, token: string, purpose: 'login' | 'sensitive_action', provider: MfaChallengeProvider): {
  userId: string;
  provider: MfaChallengeProvider;
} | null {
  const row = db.prepare(`
    SELECT userId, provider
    FROM MfaChallenge
    WHERE id = ? AND challengeHash = ? AND purpose = ? AND provider = ?
  `).get(challengeId, hashChallengeForStorage(token), purpose, provider) as { userId: string; provider: MfaChallengeProvider } | undefined;
  return row?.provider === provider ? row : null;
}

function getLoginContext(db: Database.Database, challengeId: string, token: string): {
  userId: string;
  provider: MfaChallengeProvider;
} | null {
  return getMfaChallengeContext(db, challengeId, token, 'login', 'credentials')
    ?? getMfaChallengeContext(db, challengeId, token, 'login', 'google')
    ?? getMfaChallengeContext(db, challengeId, token, 'login', 'wechat')
    ?? getMfaChallengeContext(db, challengeId, token, 'login', 'wechat-mini');
}

export function readMfaLoginChallengeContext(challengeId: string, token: string): {
  userId: string;
  provider: MfaChallengeProvider;
} | null {
  return readOnlyDatabase((db) => {
    const context = getLoginContext(db, challengeId, token);
    if (!context) return null;
    const row = db.prepare(`
      SELECT expiresAt, consumedAt
      FROM MfaChallenge
      WHERE id = ?
    `).get(challengeId) as { expiresAt: string; consumedAt: string | null } | undefined;
    if (!row || row.consumedAt || Date.parse(row.expiresAt) <= Date.now()) return null;
    return context;
  });
}

export async function verifyMfaLoginChallenge(
  challengeId: string,
  token: string,
  input: { code?: string; recoveryCode?: string },
  ip?: string | null,
): Promise<{ ok: true; login: VerifiedMfaLogin } | { ok: false; reason: string; clearCookie: boolean }> {
  if (!isMfaPhase1Enabled()) return { ok: false, reason: 'MFA_DISABLED', clearCookie: false };

  const preflightContext = readOnlyDatabase((db) => getLoginContext(db, challengeId, token));
  if (!preflightContext) return { ok: false, reason: 'MFA_CHALLENGE_INVALID', clearCookie: true };

  const rateLimit = await enforceMfaRateLimits({
    store: rateLimitStore(),
    userId: preflightContext.userId,
    provider: preflightContext.provider,
    ip,
  });
  if (!rateLimit.allowed) {
    withDatabase((db) => {
      recordSecurityEvent(db, {
        userId: preflightContext.userId,
        eventType: 'MFA_FAILED',
        ip,
        metadata: { reason: 'rate_limited', provider: preflightContext.provider },
      });
    });
    return { ok: false, reason: 'rate_limited', clearCookie: false };
  }

  return withDatabase((db) => {
    const context = getLoginContext(db, challengeId, token);
    if (!context) return { ok: false, reason: 'MFA_CHALLENGE_INVALID', clearCookie: true };
    try {
      assertUnifiedMfaStatusConsistency(db, context.userId);
    } catch (error) {
      recordSecurityEvent(db, {
        userId: context.userId,
        eventType: 'AUTHENTICATOR_DATA_CONFLICT',
        ip,
        metadata: { provider: context.provider },
      });
      console.error('[auth.mfa] authenticator data conflict:', error instanceof Error ? error.message : 'unknown');
      return { ok: false, reason: 'MFA_DATA_CONFLICT', clearCookie: true };
    }
    const now = new Date();

    if (input.recoveryCode) {
      let pepperRing;
      try {
        pepperRing = loadMfaRecoveryPepperRing();
      } catch {
        return { ok: false, reason: 'MFA_RECOVERY_UNAVAILABLE', clearCookie: false };
      }
      const legacyCodeHashes = [...pepperRing.peppers.values()].map((pepper) => hashMfaRecoveryCode(input.recoveryCode!, pepper));
      const unifiedCodeHashes = [...new Set([
        ...[...pepperRing.peppers.entries()].map(([version, pepper]) => hashMfaRecoveryCodeWithVersion(input.recoveryCode!, pepper, version)),
        ...[...pepperRing.peppers.values()].map((pepper) => hashMfaRecoveryCode(input.recoveryCode!, pepper)),
      ])];
      const legacyCodeHash = legacyCodeHashes[0];
      const result = consumeMfaRecoveryChallenge(db, {
        token,
        userId: context.userId,
        purpose: 'login',
        provider: context.provider,
        codeHash: legacyCodeHash,
        unifiedCodeHashes,
        legacyCodeHashes,
        now,
      });
      if (!result.ok) {
        const failure = result.reason === 'invalid_code'
          ? recordMfaFailure(db, { token, userId: context.userId, purpose: 'login', provider: context.provider, now })
          : null;
        recordSecurityEvent(db, {
          userId: context.userId,
          eventType: 'MFA_FAILED',
          ip,
          metadata: { reason: result.reason, method: 'recovery', provider: context.provider },
        });
        return {
          ok: false,
          reason: result.reason,
          clearCookie: result.reason === 'expired' || result.reason === 'consumed' || result.reason === 'locked' || !!failure?.locked,
        };
      }
      recordSecurityEvent(db, {
        userId: context.userId,
        eventType: 'RECOVERY_USED',
        ip,
        metadata: { provider: context.provider },
      });
      return readVerifiedUser(db, context.userId, 'recovery', now.getTime());
    }

    let envelope: string | null = null;
    if (hasUnifiedTables(db)) {
      const parts = findEnabledTotpSecret(db, context.userId);
      if (parts) envelope = joinEncryptedEnvelope(parts);
    }
    if (!envelope) {
      const setting = db.prepare(`
        SELECT encryptedSecret
        FROM MfaSetting
        WHERE userId = ? AND enabled = 1
      `).get(context.userId) as { encryptedSecret: string } | undefined;
      envelope = setting?.encryptedSecret ?? null;
    }
    const keyRing = loadMfaKeyRing();
    const secret = envelope ? decryptMfaSecret(envelope, keyRing) : null;
    const matchedStep = secret && input.code ? findTotpStep(secret, input.code, now.getTime()) : null;
    if (matchedStep === null) {
      const failure = recordMfaFailure(db, {
        token,
        userId: context.userId,
        purpose: 'login',
        provider: context.provider,
        now,
      });
      recordSecurityEvent(db, {
        userId: context.userId,
        eventType: 'MFA_FAILED',
        ip,
        metadata: { reason: 'invalid_code', method: 'totp', provider: context.provider },
      });
      return { ok: false, reason: 'MFA_CODE_INVALID', clearCookie: failure.locked };
    }

    const result = consumeMfaChallenge(db, {
      token,
      userId: context.userId,
      purpose: 'login',
      provider: context.provider,
      matchedStep,
      now,
    });
    if (!result.ok) {
      recordSecurityEvent(db, {
        userId: context.userId,
        eventType: 'MFA_FAILED',
        ip,
        metadata: { reason: result.reason, method: 'totp', provider: context.provider },
      });
      return {
        ok: false,
        reason: result.reason,
        clearCookie: result.reason === 'expired' || result.reason === 'consumed' || result.reason === 'locked',
      };
    }
    recordSecurityEvent(db, {
      userId: context.userId,
      eventType: 'MFA_SUCCESS',
      ip,
      metadata: { method: 'totp', provider: context.provider },
    });
    return readVerifiedUser(db, context.userId, 'totp', now.getTime());
  });
}

export async function verifyMfaStepUpChallenge(
  challengeId: string,
  token: string,
  userId: string,
  code: string,
  ip?: string | null,
): Promise<MfaStepUpVerification> {
  if (!isMfaPhase1Enabled()) return { ok: false, reason: 'MFA_DISABLED', clearCookie: false };

  const preflightContext = readOnlyDatabase((db) => getMfaChallengeContext(db, challengeId, token, 'sensitive_action', 'credentials'));
  if (!preflightContext || preflightContext.userId !== userId) return { ok: false, reason: 'MFA_CHALLENGE_INVALID', clearCookie: true };

  const rateLimit = await enforceMfaRateLimits({
    store: rateLimitStore(),
    userId,
    provider: 'credentials',
    ip,
  });
  if (!rateLimit.allowed) {
    withDatabase((db) => recordSecurityEvent(db, {
      userId,
      eventType: 'MFA_FAILED',
      ip,
      metadata: { reason: 'rate_limited', method: 'totp', provider: 'credentials' },
    }));
    return { ok: false, reason: 'rate_limited', clearCookie: false };
  }

  return withDatabase((db) => {
    const context = getMfaChallengeContext(db, challengeId, token, 'sensitive_action', 'credentials');
    if (!context || context.userId !== userId) return { ok: false, reason: 'MFA_CHALLENGE_INVALID', clearCookie: true };

    try {
      assertUnifiedMfaStatusConsistency(db, userId);
    } catch (error) {
      recordSecurityEvent(db, { userId, eventType: 'AUTHENTICATOR_DATA_CONFLICT', ip, metadata: { provider: 'credentials' } });
      console.error('[auth.mfa-step-up] authenticator data conflict:', error instanceof Error ? error.message : 'unknown');
      return { ok: false, reason: 'MFA_DATA_CONFLICT', clearCookie: true };
    }

    const now = new Date();
    let envelope: string | null = null;
    if (hasUnifiedTables(db)) {
      const parts = findEnabledTotpSecret(db, userId);
      if (parts) envelope = joinEncryptedEnvelope(parts);
    }
    if (!envelope) {
      const setting = db.prepare(`
        SELECT encryptedSecret
        FROM MfaSetting
        WHERE userId = ? AND enabled = 1
      `).get(userId) as { encryptedSecret: string } | undefined;
      envelope = setting?.encryptedSecret ?? null;
    }

    const keyRing = loadMfaKeyRing();
    const secret = envelope ? decryptMfaSecret(envelope, keyRing) : null;
    const matchedStep = secret ? findTotpStep(secret, code, now.getTime()) : null;
    if (matchedStep === null) {
      const failure = recordMfaFailure(db, {
        token,
        userId,
        purpose: 'sensitive_action',
        provider: 'credentials',
        now,
      });
      recordSecurityEvent(db, {
        userId,
        eventType: 'MFA_FAILED',
        ip,
        metadata: { reason: 'invalid_code', method: 'totp', provider: 'credentials' },
      });
      return { ok: false, reason: 'MFA_CODE_INVALID', clearCookie: failure.locked };
    }

    const result = consumeMfaChallenge(db, {
      token,
      userId,
      purpose: 'sensitive_action',
      provider: 'credentials',
      matchedStep,
      now,
    });
    if (!result.ok) {
      recordSecurityEvent(db, {
        userId,
        eventType: 'MFA_FAILED',
        ip,
        metadata: { reason: result.reason, method: 'totp', provider: 'credentials' },
      });
      return {
        ok: false,
        reason: result.reason,
        clearCookie: result.reason === 'expired' || result.reason === 'consumed' || result.reason === 'locked',
      };
    }

    recordSecurityEvent(db, {
      userId,
      eventType: 'MFA_SUCCESS',
      ip,
      metadata: { method: 'totp', provider: 'credentials' },
    });
    return { ok: true, verifiedAt: now.getTime() };
  });
}

function readVerifiedUser(
  db: Database.Database,
  userId: string,
  mfaMethod: 'totp' | 'recovery',
  mfaVerifiedAt: number,
): { ok: true; login: VerifiedMfaLogin } | { ok: false; reason: string; clearCookie: boolean } {
  const user = db.prepare('SELECT id, email, name FROM User WHERE id = ?').get(userId) as UserRow | undefined;
  if (!user) return { ok: false, reason: 'USER_NOT_FOUND', clearCookie: true };
  return {
    ok: true,
    login: {
      userId: user.id,
      email: user.email,
      name: user.name,
      mfaMethod,
      mfaVerifiedAt,
    },
  };
}
