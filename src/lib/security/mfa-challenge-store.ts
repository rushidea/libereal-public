import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  advanceUnifiedLastUsedStep,
  consumeUnifiedRecoveryCode,
  hasUnifiedTables,
  readUnifiedMfaStatus,
  readUnifiedLastUsedStepState,
  updateUnifiedLastVerifiedAt,
} from './unified-authenticator-store';

export type MfaChallengePurpose = 'login' | 'setup' | 'recovery' | 'sensitive_action';
export type MfaChallengeProvider = 'credentials' | 'google' | 'wechat' | 'wechat-mini';

export interface MfaChallengeInput {
  userId: string;
  purpose: MfaChallengePurpose;
  provider: MfaChallengeProvider;
  now?: Date;
  ttlMs?: number;
}

export interface CreatedMfaChallenge {
  id: string;
  token: string;
  expiresAt: Date;
}

export type MfaChallengeConsumeResult =
  | { ok: true; userId: string; matchedStep: number }
  | { ok: false; reason: 'missing' | 'expired' | 'consumed' | 'locked' | 'mismatch' | 'replay' };

export type MfaRecoveryConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'missing' | 'expired' | 'consumed' | 'locked' | 'mismatch' | 'invalid_code' };

const DEFAULT_TTL_MS = 5 * 60 * 1000;
export const MFA_MAX_ATTEMPTS = 5;

function hashChallengeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toIso(date: Date): string {
  return date.toISOString();
}

function parseDate(value: string): Date {
  return new Date(value.endsWith('Z') ? value : `${value}Z`);
}

/**
 * The token is returned once and only its SHA-256 digest is persisted.
 * The caller is responsible for setting the digest's token in an HttpOnly cookie.
 */
export function createMfaChallenge(
  db: Database.Database,
  input: MfaChallengeInput,
): CreatedMfaChallenge {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS));
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');

  db.prepare(`
    INSERT INTO MfaChallenge
      (id, userId, challengeHash, purpose, provider, expiresAt, attemptCount, consumedAt, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)
  `).run(
    id,
    input.userId,
    hashChallengeToken(token),
    input.purpose,
    input.provider,
    toIso(expiresAt),
    toIso(now),
  );

  return { id, token, expiresAt };
}

interface ChallengeRow {
  id: string;
  userId: string;
  expiresAt: string;
  attemptCount: number;
  consumedAt: string | null;
  purpose: MfaChallengePurpose;
  provider: MfaChallengeProvider;
}

/**
 * Atomically consumes a challenge and advances the user's TOTP step.
 * TOTP calculation is deliberately outside this store; the caller supplies
 * the already matched step so the encrypted secret never enters this layer.
 */
export function consumeMfaChallenge(
  db: Database.Database,
  input: {
    token: string;
    userId: string;
    purpose: 'login' | 'sensitive_action';
    provider: MfaChallengeProvider;
    matchedStep: number;
    now?: Date;
  },
): MfaChallengeConsumeResult {
  const now = input.now ?? new Date();
  const nowIso = toIso(now);

  const run = db.transaction((): MfaChallengeConsumeResult => {
    const row = db.prepare(`
      SELECT id, userId, expiresAt, attemptCount, consumedAt, purpose, provider
      FROM MfaChallenge
      WHERE challengeHash = ?
    `).get(hashChallengeToken(input.token)) as ChallengeRow | undefined;

    if (!row) return { ok: false, reason: 'missing' };
    if (row.userId !== input.userId || row.purpose !== input.purpose || row.provider !== input.provider) {
      return { ok: false, reason: 'mismatch' };
    }
    if (row.consumedAt) return { ok: false, reason: 'consumed' };
    if (parseDate(row.expiresAt) <= now) return { ok: false, reason: 'expired' };
    if (row.attemptCount >= MFA_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };

    const unifiedState = hasUnifiedTables(db) ? readUnifiedLastUsedStepState(db, input.userId) : null;
    const useUnified = Boolean(unifiedState?.found);
    if (useUnified) {
      const lastUsedStep = unifiedState!.lastUsedStep;
      if (lastUsedStep !== null && input.matchedStep <= lastUsedStep) {
        return { ok: false, reason: 'replay' };
      }
      const legacySetting = db.prepare(`
        SELECT lastUsedStep, lastVerifiedAt
        FROM MfaSetting
        WHERE userId = ? AND enabled = 1
      `).get(input.userId) as { lastUsedStep: number | null; lastVerifiedAt: string | null } | undefined;
      if (legacySetting && (
        legacySetting.lastUsedStep !== unifiedState!.lastUsedStep ||
        legacySetting.lastVerifiedAt !== unifiedState!.lastUsedAt
      )) return { ok: false, reason: 'mismatch' };

      // Update the legacy representation first; if either side fails, the
      // surrounding transaction rolls both writes back.
      if (legacySetting) {
        const legacyUpdate = db.prepare(`
        UPDATE MfaSetting
        SET lastUsedStep = ?, lastVerifiedAt = ?, updatedAt = ?
        WHERE userId = ? AND enabled = 1
          AND (lastUsedStep IS NULL OR lastUsedStep < ?)
        `).run(input.matchedStep, nowIso, nowIso, input.userId, input.matchedStep);
        if (legacyUpdate.changes !== 1) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
      }
      const advanced = advanceUnifiedLastUsedStep(db, input.userId, input.matchedStep, nowIso);
      if (!advanced) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
    } else {
      const setting = db.prepare(`
        SELECT lastUsedStep
        FROM MfaSetting
        WHERE userId = ? AND enabled = 1
      `).get(input.userId) as { lastUsedStep: number | null } | undefined;
      if (!setting) return { ok: false, reason: 'mismatch' };
      if (setting.lastUsedStep !== null && input.matchedStep <= setting.lastUsedStep) {
        return { ok: false, reason: 'replay' };
      }
      const settingUpdate = db.prepare(`
        UPDATE MfaSetting
        SET lastUsedStep = ?, lastVerifiedAt = ?, updatedAt = ?
        WHERE userId = ? AND enabled = 1
          AND (lastUsedStep IS NULL OR lastUsedStep < ?)
      `).run(input.matchedStep, nowIso, nowIso, input.userId, input.matchedStep);
      if (settingUpdate.changes !== 1) return { ok: false, reason: 'replay' };
    }

    const challengeUpdate = db.prepare(`
      UPDATE MfaChallenge
      SET consumedAt = ?
      WHERE id = ? AND consumedAt IS NULL AND attemptCount < ?
    `).run(nowIso, row.id, MFA_MAX_ATTEMPTS);
    if (challengeUpdate.changes !== 1) return { ok: false, reason: 'consumed' };

    return { ok: true, userId: row.userId, matchedStep: input.matchedStep };
  });

  return run();
}

export function recordMfaFailure(
  db: Database.Database,
  input: { token: string; userId: string; purpose: MfaChallengePurpose; provider: MfaChallengeProvider; now?: Date },
): { accepted: boolean; attemptCount: number; locked: boolean } {
  const now = input.now ?? new Date();
  const result = db.prepare(`
    UPDATE MfaChallenge
    SET attemptCount = attemptCount + 1
      WHERE challengeHash = ? AND userId = ? AND purpose = ? AND provider = ?
      AND consumedAt IS NULL AND expiresAt > ? AND attemptCount < ?
    `).run(hashChallengeToken(input.token), input.userId, input.purpose, input.provider, toIso(now), MFA_MAX_ATTEMPTS);

  const row = db.prepare(`
    SELECT attemptCount
    FROM MfaChallenge
    WHERE challengeHash = ?
  `).get(hashChallengeToken(input.token)) as { attemptCount: number } | undefined;
  const attemptCount = row?.attemptCount ?? MFA_MAX_ATTEMPTS;
  return { accepted: result.changes === 1, attemptCount, locked: attemptCount >= MFA_MAX_ATTEMPTS };
}

export function consumeMfaRecoveryChallenge(
  db: Database.Database,
  input: {
    token: string;
    userId: string;
    purpose: 'login';
    provider: MfaChallengeProvider;
    codeHash: string;
    unifiedCodeHashes?: string[];
    legacyCodeHashes?: string[];
    now?: Date;
  },
): MfaRecoveryConsumeResult {
  const now = input.now ?? new Date();
  const nowIso = toIso(now);
  const run = db.transaction((): MfaRecoveryConsumeResult => {
    const row = db.prepare(`
      SELECT id, userId, expiresAt, attemptCount, consumedAt, purpose, provider
      FROM MfaChallenge
      WHERE challengeHash = ?
    `).get(hashChallengeToken(input.token)) as ChallengeRow | undefined;

    if (!row) return { ok: false, reason: 'missing' };
    if (row.userId !== input.userId || row.purpose !== input.purpose || row.provider !== input.provider) {
      return { ok: false, reason: 'mismatch' };
    }
    if (row.consumedAt) return { ok: false, reason: 'consumed' };
    if (parseDate(row.expiresAt) <= now) return { ok: false, reason: 'expired' };
    if (row.attemptCount >= MFA_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };

    const setting = db.prepare(`
      SELECT enabled
      FROM MfaSetting
      WHERE userId = ?
    `).get(input.userId) as { enabled: number } | undefined;
    if (!setting || setting.enabled !== 1) return { ok: false, reason: 'mismatch' };

    const unified = hasUnifiedTables(db);
    const unifiedStatus = unified ? readUnifiedMfaStatus(db, input.userId) : null;
    if (unifiedStatus) {
      const consumed = consumeUnifiedRecoveryCode(db, input.userId, input.unifiedCodeHashes ?? [input.codeHash], nowIso);
      if (!consumed) return { ok: false, reason: 'invalid_code' };
      const legacyUpdate = db.prepare(`
        UPDATE MfaRecoveryCode
        SET usedAt = ?
        WHERE userId = ? AND codeHash = ? AND usedAt IS NULL
      `);
      let legacyChanges = 0;
      for (const legacyCodeHash of new Set([input.codeHash, ...(input.legacyCodeHashes ?? [])])) {
        const result = legacyUpdate.run(nowIso, input.userId, legacyCodeHash);
        if (result.changes === 1) {
          legacyChanges = 1;
          break;
        }
      }
      if (legacyChanges !== 1) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
    } else {
      const codeUpdate = db.prepare(`
        UPDATE MfaRecoveryCode
        SET usedAt = ?
        WHERE userId = ? AND codeHash = ? AND usedAt IS NULL
      `);
      let codeChanges = 0;
      for (const legacyCodeHash of new Set([input.codeHash, ...(input.legacyCodeHashes ?? [])])) {
        const result = codeUpdate.run(nowIso, input.userId, legacyCodeHash);
        if (result.changes === 1) {
          codeChanges = 1;
          break;
        }
      }
      if (codeChanges !== 1) return { ok: false, reason: 'invalid_code' };
    }

    const challengeUpdate = db.prepare(`
      UPDATE MfaChallenge
      SET consumedAt = ?
      WHERE id = ? AND consumedAt IS NULL AND attemptCount < ?
    `).run(nowIso, row.id, MFA_MAX_ATTEMPTS);
    if (challengeUpdate.changes !== 1) return { ok: false, reason: 'consumed' };
    if (unifiedStatus && !updateUnifiedLastVerifiedAt(db, input.userId, nowIso)) {
      throw new Error('AUTHENTICATOR_DATA_CONFLICT');
    }
    const legacyVerifiedUpdate = db.prepare(`
      UPDATE MfaSetting
      SET lastVerifiedAt = ?, updatedAt = ?
      WHERE userId = ? AND enabled = 1
    `).run(nowIso, nowIso, input.userId);
    if (legacyVerifiedUpdate.changes !== 1) throw new Error('AUTHENTICATOR_DATA_CONFLICT');
    return { ok: true, userId: row.userId };
  });

  return run();
}

export function hashChallengeForStorage(token: string): string {
  return hashChallengeToken(token);
}
