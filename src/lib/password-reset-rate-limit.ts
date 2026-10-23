import { createHash } from 'crypto';
import { getEphemeralStore } from '@/lib/ephemeral-store';

const SOURCE_WINDOW_MS = 60 * 60 * 1000;
const SOURCE_LIMIT = 20;
const EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;
const EMAIL_LIMIT = 5;
const EMAIL_COOLDOWN_MS = 5 * 60 * 1000;

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Counts source attempts before any account lookup. The email cooldown is claimed
 * before its daily quota, so repeated requests during cooldown do not burn quota.
 * Callers must fail closed on exceptions because an unavailable store cannot
 * safely enforce these limits.
 */
export async function admitPasswordResetEmail(ip: string, normalizedEmail: string): Promise<boolean> {
  const store = getEphemeralStore();
  const sourceCount = await store.increment(`password-reset:source:${digest(ip)}`, SOURCE_WINDOW_MS);
  if (sourceCount > SOURCE_LIMIT) return false;

  const emailHash = digest(normalizedEmail);
  const cooldown = await store.acquireLock(`password-reset:cooldown:${emailHash}`, EMAIL_COOLDOWN_MS);
  if (!cooldown) return false;

  // Count unknown addresses too, before account lookup, to prevent enumeration.
  const emailCount = await store.increment(`password-reset:email:${emailHash}`, EMAIL_WINDOW_MS);
  return emailCount <= EMAIL_LIMIT;
}
