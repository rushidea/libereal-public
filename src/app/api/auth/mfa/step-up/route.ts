import { NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { isMfaPhase1Enabled } from '@/lib/security/mfa-config';
import { getRequestIp } from '@/lib/security/mfa-rate-limit';
import {
  clearMfaChallengeCookie,
  readMfaChallengeCookie,
  setMfaChallengeCookie,
} from '@/lib/security/mfa-cookie';
import {
  createMfaStepUpChallenge,
  verifyMfaStepUpChallenge,
} from '@/lib/security/mfa-service';
import { markSecuritySessionMfaVerified } from '@/lib/security/security-session-service';

const CHALLENGE_ID_PATTERN = /^[0-9a-f-]{36}$/i;

function errorResponse(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  if (!isMfaPhase1Enabled()) return errorResponse('Not found', 404);

  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  if (!user.sessionId) return errorResponse('Active session required', 409);

  const body = await request.json().catch(() => null) as { challengeId?: string; code?: string; grantScope?: string } | null;
  if (body?.grantScope) return errorResponse('请使用统一安全验证接口', 410);
  const challengeId = typeof body?.challengeId === 'string' ? body.challengeId.trim() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  const ip = await getRequestIp();

  if (!challengeId && !code) {
    try {
      const challenge = await createMfaStepUpChallenge(user.id, ip);
      await setMfaChallengeCookie(challenge.id, challenge.token);
      return NextResponse.json({ challengeId: challenge.id, expiresAt: challenge.expiresAt.toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'MFA_TOTP_NOT_ENABLED') return errorResponse('TOTP is not enabled', 409);
      if (message === 'MFA_CHALLENGE_RATE_LIMITED') return errorResponse('Too many MFA verification requests', 429);
      console.error('[mfa.step-up.start] failed:', message || 'unknown');
      return errorResponse('MFA step-up unavailable', 503);
    }
  }

  if (!CHALLENGE_ID_PATTERN.test(challengeId)) return errorResponse('Invalid MFA challenge', 400);
  if (!/^\d{6}$/.test(code)) return errorResponse('请输入 6 位验证码', 400);

  const token = await readMfaChallengeCookie(challengeId);
  if (!token) return errorResponse('MFA challenge unavailable', 400);

  const result = await verifyMfaStepUpChallenge(challengeId, token, user.id, code, ip);
  if (!result.ok) {
    if (result.clearCookie) await clearMfaChallengeCookie(challengeId);
    if (result.reason === 'rate_limited') return errorResponse('Too many MFA verification attempts', 429);
    if (result.reason === 'expired') return errorResponse('MFA challenge expired', 410);
    if (result.reason === 'consumed' || result.reason === 'replay') return errorResponse('MFA challenge already used', 409);
    if (result.reason === 'MFA_CODE_INVALID') return errorResponse('验证码错误', 400);
    if (result.reason === 'MFA_DATA_CONFLICT') return errorResponse('MFA state unavailable', 503);
    return errorResponse('MFA challenge invalid', 400);
  }

  const marked = await markSecuritySessionMfaVerified(user.id, user.sessionId, new Date(result.verifiedAt));
  await clearMfaChallengeCookie(challengeId);
  if (!marked) return errorResponse('Active session required', 401);
  return NextResponse.json({ ok: true, verifiedAt: result.verifiedAt }, { headers: { 'Cache-Control': 'no-store' } });
}
