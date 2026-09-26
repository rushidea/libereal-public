import { createHash, randomBytes } from 'node:crypto';
import { getEphemeralStore } from '@/lib/ephemeral-store';

export const ADMIN_MFA_ADJUSTMENT_SCOPE = 'admin_mfa_policy' as const;
const ADMIN_MFA_ADJUSTMENT_GRANT_TTL_MS = 5 * 60 * 1000;

function grantKey(token: string): string {
  return `admin-mfa-adjustment:${createHash('sha256').update(token).digest('hex')}`;
}

export async function issueAdminMfaAdjustmentGrant(input: { userId: string; sessionId: string }): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await getEphemeralStore().set(grantKey(token), JSON.stringify(input), ADMIN_MFA_ADJUSTMENT_GRANT_TTL_MS);
  return token;
}

export async function consumeAdminMfaAdjustmentGrant(token: string, input: { userId: string; sessionId: string }): Promise<boolean> {
  if (!token || token.length > 256) return false;
  const key = grantKey(token);
  const stored = await getEphemeralStore().get(key);
  if (!stored) return false;
  try {
    const grant = JSON.parse(stored) as { userId?: string; sessionId?: string };
    if (grant.userId === input.userId && grant.sessionId === input.sessionId) {
      return getEphemeralStore().compareAndDelete(key, stored);
    }
  } catch {
    return false;
  }
  return false;
}
