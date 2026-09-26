export function isMfaPhase1Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MFA_PHASE1_ENABLED?.trim().toLowerCase() === 'true';
}

export function isMfaAdminRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MFA_ADMIN_REQUIRED?.trim().toLowerCase() === 'true';
}

export function isPasskeyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isMfaPhase1Enabled(env) && env.PASSKEY_ENABLED?.trim().toLowerCase() === 'true';
}

export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MFA_RECENT_WINDOW_MS = 10 * 60 * 1000;
