import { createHash, randomBytes } from 'node:crypto';
import { getEphemeralStore, type EphemeralStore } from '@/lib/ephemeral-store';

const PASSKEY_VERIFIED_TOKEN_TTL_MS = 2 * 60 * 1000;

export interface PasskeyVerifiedLogin {
  userId: string;
  email: string;
  name: string | null;
  challengeId: string;
  challengeTokenHash: string;
  mfaVerifiedAt: number;
}

type PasskeySessionStore = Pick<EphemeralStore, 'get' | 'set' | 'compareAndDelete'>;

function key(token: string): string {
  const digest = createHash('sha256').update(token).digest('hex');
  return `passkey:verified:${digest}`;
}

export async function issuePasskeyVerifiedToken(input: PasskeyVerifiedLogin, storeOverride?: PasskeySessionStore): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await (storeOverride ?? getEphemeralStore()).set(key(token), JSON.stringify(input), PASSKEY_VERIFIED_TOKEN_TTL_MS);
  return token;
}

export async function consumePasskeyVerifiedToken(
  token: string,
  challengeId: string,
  challengeToken: string,
  storeOverride?: PasskeySessionStore,
): Promise<PasskeyVerifiedLogin | null> {
  if (!token) return null;
  const store = storeOverride ?? getEphemeralStore();
  const raw = await store.get(key(token));
  if (!raw) return null;

  if (!challengeId) {
    await store.compareAndDelete(key(token), raw);
    return null;
  }

  // The temporary proof must never be consumable without the original
  // HttpOnly MFA challenge cookie. If the cookie is missing, burn the proof.
  if (!challengeToken) {
    await store.compareAndDelete(key(token), raw);
    return null;
  }

  let input: PasskeyVerifiedLogin;
  try {
    input = JSON.parse(raw) as PasskeyVerifiedLogin;
  } catch {
    await store.compareAndDelete(key(token), raw);
    return null;
  }
  const valid = input.challengeId === challengeId &&
    input.challengeTokenHash === createHash('sha256').update(challengeToken).digest('hex') &&
    Boolean(input.userId) &&
    Boolean(input.email) &&
    Boolean(input.challengeTokenHash) &&
    typeof input.mfaVerifiedAt === 'number';
  if (!valid) {
    await store.compareAndDelete(key(token), raw);
    return null;
  }
  if (!(await store.compareAndDelete(key(token), raw))) return null;
  return input;
}
