import { cookies } from 'next/headers';

const COOKIE_PREFIX = 'libereal-mfa-challenge-';
export const MFA_CHALLENGE_COOKIE_MAX_AGE = 5 * 60;

function assertChallengeId(challengeId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) throw new Error('MFA_CHALLENGE_ID_INVALID');
  return challengeId;
}

export function getMfaChallengeCookieName(challengeId: string): string {
  return `${process.env.NODE_ENV === 'production' ? '__Secure-' : ''}${COOKIE_PREFIX}${assertChallengeId(challengeId)}`;
}

export async function setMfaChallengeCookie(challengeId: string, token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(getMfaChallengeCookieName(challengeId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MFA_CHALLENGE_COOKIE_MAX_AGE,
  });
}

export async function readMfaChallengeCookie(challengeId: string): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(getMfaChallengeCookieName(challengeId))?.value ?? null;
}

export async function clearMfaChallengeCookie(challengeId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(getMfaChallengeCookieName(challengeId), '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
