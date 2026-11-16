import { createHash } from 'node:crypto';

/** Runtime-only configuration. An HTTP request cannot select the deployment or test account. */
export function getStagingMfaTestConfig(userId: string, env: NodeJS.ProcessEnv = process.env): { codeHash: string; scope: string } | null {
  if (env.LIBEREAL_RUNTIME_ENV !== 'staging' || env.STAGING_MFA_TEST_ENABLED !== 'true') return null;
  try {
    const origin = new URL(env.AUTH_URL || '');
    if (origin.protocol !== 'https:' || !origin.hostname.startsWith('staging.')
      || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
      || origin.origin !== env.STAGING_MFA_TEST_ORIGIN) return null;
    const users: unknown = JSON.parse(env.STAGING_MFA_TEST_USER_IDS || 'null');
    const codeHash = env.STAGING_MFA_TEST_CODE_SHA256 || '';
    if (!Array.isArray(users) || users.length === 0 || users.length > 20
      || !users.every(id => typeof id === 'string' && id.length > 0 && id.length <= 128)
      || !users.includes(userId) || !/^[a-f0-9]{64}$/.test(codeHash)) return null;
    return { codeHash, scope: createHash('sha256').update(JSON.stringify({ origin: origin.origin, users, codeHash })).digest('hex') };
  } catch { return null; }
}

export function hashStagingMfaTestCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}
