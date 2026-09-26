import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { encode } from 'next-auth/jwt';

export type SpikeProvider = 'credentials' | 'google' | 'wechat' | 'wechat-mini';
export type SpikeAuthLevel = 'primary_verified' | 'mfa_verified';

export interface SpikePrimaryIdentity {
  userId: string;
  email: string;
  provider: SpikeProvider;
}

export interface SpikeMfaIdentity extends SpikePrimaryIdentity {
  authLevel: 'mfa_verified';
  mfaVerifiedAt: number;
  mfaMethod: 'totp';
  sessionId: string;
}

export interface SpikePrimaryIdentityResult extends SpikePrimaryIdentity {
  authLevel: 'primary_verified';
}

export interface SpikeChallengeResult {
  kind: 'mfa_challenge';
  challengeToken: string;
  expiresAt: number;
}

type ChallengeRecord = {
  identity: SpikePrimaryIdentity;
  expiresAt: number;
  attemptCount: number;
  consumedAt: number | null;
};

type MfaSettings = {
  secret: string;
  enabled: boolean;
  lastUsedStep: number | null;
};

const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_WINDOW_STEPS = 1;
const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGE_ATTEMPTS = 5;

function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function decodeBase32(secret: string): Buffer {
  const normalized = secret.toUpperCase().replace(/[\s=-]/g, '');
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error('INVALID_TOTP_SECRET');
  }

  const output: number[] = [];
  let value = 0;
  let bits = 0;

  for (const character of normalized) {
    value = (value << 5) | (character.charCodeAt(0) >= 65
      ? character.charCodeAt(0) - 65
      : character.charCodeAt(0) - 24);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }

  return Buffer.from(output);
}

function safeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/** RFC 6238 TOTP calculation used only by the Phase 1-A protocol Spike. */
export function totpCodeAt(secret: string, nowMs: number, stepSeconds = DEFAULT_STEP_SECONDS): string {
  const counter = BigInt(Math.floor(nowMs / 1000 / stepSeconds));
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);

  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3];

  return String(binary % 1_000_000).padStart(6, '0');
}

function findTotpStep(
  secret: string,
  code: string,
  nowMs: number,
  stepSeconds: number,
  windowSteps: number,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;

  const currentStep = Math.floor(nowMs / 1000 / stepSeconds);
  for (let offset = -windowSteps; offset <= windowSteps; offset += 1) {
    const stepNowMs = (currentStep + offset) * stepSeconds * 1000;
    if (safeEqualText(totpCodeAt(secret, stepNowMs, stepSeconds), code)) {
      return currentStep + offset;
    }
  }
  return null;
}

export class SpikeMfaStore {
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly settings = new Map<string, MfaSettings>();

  registerTotp(userId: string, secret: string): void {
    decodeBase32(secret);
    this.settings.set(userId, { secret, enabled: true, lastUsedStep: null });
  }

  createChallenge(
    identity: SpikePrimaryIdentity,
    nowMs: number,
    ttlMs = DEFAULT_CHALLENGE_TTL_MS,
  ): SpikeChallengeResult {
    const challengeToken = randomBytes(32).toString('base64url');
    this.challenges.set(hashOpaqueToken(challengeToken), {
      identity,
      expiresAt: nowMs + ttlMs,
      attemptCount: 0,
      consumedAt: null,
    });
    return { kind: 'mfa_challenge', challengeToken, expiresAt: nowMs + ttlMs };
  }

  verifyChallenge(challengeToken: string, code: string, nowMs: number): SpikeMfaIdentity | null {
    const record = this.challenges.get(hashOpaqueToken(challengeToken));
    if (!record || record.consumedAt !== null || nowMs >= record.expiresAt) return null;
    if (record.attemptCount >= MAX_CHALLENGE_ATTEMPTS) return null;

    const settings = this.settings.get(record.identity.userId);
    if (!settings?.enabled) return null;

    const matchedStep = findTotpStep(
      settings.secret,
      code,
      nowMs,
      DEFAULT_STEP_SECONDS,
      DEFAULT_WINDOW_STEPS,
    );
    if (matchedStep === null || (settings.lastUsedStep !== null && matchedStep <= settings.lastUsedStep)) {
      record.attemptCount += 1;
      return null;
    }

    record.consumedAt = nowMs;
    settings.lastUsedStep = matchedStep;
    return {
      ...record.identity,
      authLevel: 'mfa_verified',
      mfaVerifiedAt: nowMs,
      mfaMethod: 'totp',
      sessionId: randomBytes(16).toString('hex'),
    };
  }
}

export function beginPrimaryAuthentication(
  store: SpikeMfaStore,
  identity: SpikePrimaryIdentity,
  options: { mfaRequired: boolean; nowMs: number },
): SpikePrimaryIdentityResult | SpikeChallengeResult {
  if (!options.mfaRequired) return { ...identity, authLevel: 'primary_verified' };
  return store.createChallenge(identity, options.nowMs);
}

/**
 * Encodes only a completed MFA identity with the same Auth.js JWT primitive
 * used by the application. Primary identities intentionally cannot reach it.
 */
export async function encodeSpikeMfaJwt(
  identity: SpikeMfaIdentity,
  options: { secret: string; salt: string },
): Promise<string> {
  if (identity.authLevel !== 'mfa_verified') {
    throw new Error('MFA_REQUIRED');
  }

  return encode({
    secret: options.secret,
    salt: options.salt,
    token: {
      sub: identity.userId,
      email: identity.email,
      authLevel: identity.authLevel,
      mfaVerifiedAt: identity.mfaVerifiedAt,
      mfaMethod: identity.mfaMethod,
      sessionId: identity.sessionId,
    },
  });
}
