import { getEphemeralStore, type EphemeralStore } from '@/lib/ephemeral-store';

export interface MfaRateLimitPolicy {
  user: number;
  ip: number;
  provider: number;
  setup: number;
  windowMs: number;
}

export const MFA_RATE_LIMIT_POLICY: MfaRateLimitPolicy = {
  user: 10,
  ip: 30,
  provider: 20,
  setup: 5,
  windowMs: 10 * 60 * 1000,
};

export const MFA_CHALLENGE_CREATION_POLICY = {
  user: 10,
  ip: 30,
  provider: 20,
  windowMs: 10 * 60 * 1000,
} as const;

export type MfaRateLimitScope = 'user' | 'ip' | 'provider' | 'setup';
export type MfaRateLimitStore = Pick<EphemeralStore, 'increment'>;

export function mfaRateLimitKey(scope: MfaRateLimitScope, id: string): string {
  return `mfa:${scope}:${id}`;
}

export interface MfaRateLimitResult {
  allowed: boolean;
  reasons: string[];
  counts: Partial<Record<MfaRateLimitScope, number>>;
}

export async function enforceMfaRateLimits(input: {
  store?: MfaRateLimitStore;
  policy?: MfaRateLimitPolicy;
  userId: string;
  provider: string;
  ip?: string | null;
  setup?: boolean;
}): Promise<MfaRateLimitResult> {
  const store = input.store ?? getEphemeralStore();
  const policy = input.policy ?? MFA_RATE_LIMIT_POLICY;
  const checks: Array<{ scope: MfaRateLimitScope; id: string; limit: number }> = [
    { scope: 'user', id: input.userId, limit: policy.user },
    { scope: 'provider', id: `${input.provider}:${input.userId}`, limit: policy.provider },
  ];
  if (input.ip) checks.push({ scope: 'ip', id: input.ip, limit: policy.ip });
  if (input.setup) checks.push({ scope: 'setup', id: input.userId, limit: policy.setup });

  const reasons: string[] = [];
  const counts: Partial<Record<MfaRateLimitScope, number>> = {};
  for (const check of checks) {
    const count = await store.increment(mfaRateLimitKey(check.scope, check.id), policy.windowMs);
    counts[check.scope] = count;
    if (count > check.limit) reasons.push(`${check.scope}_limit`);
  }
  return { allowed: reasons.length === 0, reasons, counts };
}

/**
 * Login Challenge issuance has its own buckets. Keeping these keys separate
 * from verification-attempt buckets prevents an attacker from exhausting the
 * verification budget merely by requesting new challenges, while still
 * limiting challenge creation before any OTP is submitted.
 */
export async function enforceMfaChallengeCreationRateLimits(input: {
  store?: MfaRateLimitStore;
  userId: string;
  provider: string;
  ip?: string | null;
  policy?: typeof MFA_CHALLENGE_CREATION_POLICY;
}): Promise<MfaRateLimitResult> {
  const store = input.store ?? getEphemeralStore();
  const policy = input.policy ?? MFA_CHALLENGE_CREATION_POLICY;
  const checks: Array<{ scope: MfaRateLimitScope; id: string; limit: number }> = [
    { scope: 'user', id: `challenge:${input.userId}`, limit: policy.user },
    { scope: 'provider', id: `challenge:${input.provider}:${input.userId}`, limit: policy.provider },
  ];
  if (input.ip) checks.push({ scope: 'ip', id: `challenge:${input.ip}`, limit: policy.ip });

  const reasons: string[] = [];
  const counts: Partial<Record<MfaRateLimitScope, number>> = {};
  for (const check of checks) {
    const count = await store.increment(mfaRateLimitKey(check.scope, check.id), policy.windowMs);
    counts[check.scope] = count;
    if (count > check.limit) reasons.push(`${check.scope}_challenge_limit`);
  }
  return { allowed: reasons.length === 0, reasons, counts };
}

export function createMemoryMfaRateLimitStore(): MfaRateLimitStore {
  const entries = new Map<string, { count: number; expiresAt: number }>();
  return {
    async increment(key: string, ttlMs: number): Promise<number> {
      const now = Date.now();
      const entry = entries.get(key);
      const count = entry && entry.expiresAt > now ? entry.count + 1 : 1;
      entries.set(key, { count, expiresAt: now + ttlMs });
      return count;
    },
  };
}

/**
 * Best-effort request IP extraction. Returns null when headers are not
 * available (tests, build, or mocked next/headers).
 */
export async function getRequestIp(): Promise<string | null> {
  try {
    const { headers } = await import('next/headers');
    const list = await headers();
    const trustedHeader = process.env.MFA_TRUSTED_PROXY_HEADER?.trim().toLowerCase();
    if (!trustedHeader || !/^[a-z0-9-]+$/.test(trustedHeader)) return null;
    return list.get(trustedHeader)?.trim() || null;
  } catch {
    return null;
  }
}
