import { NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { getRequestIp } from '@/lib/security/mfa-rate-limit';
import {
  completeSecurityStepUp,
  getSecurityStepUpAvailability,
  isSecurityStepUpAction,
  isSecurityStepUpMethod,
  startSecurityStepUp,
} from '@/lib/security/security-step-up';
import { clearMfaChallengeCookie, readMfaChallengeCookie, setMfaChallengeCookie } from '@/lib/security/mfa-cookie';
import { markSecuritySessionMfaVerified } from '@/lib/security/security-session-service';

function errorResponse(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function mapError(error: string): { message: string; status: number } {
  switch (error) {
    case 'expired': return { message: '验证码已过期，请重新获取。', status: 410 };
    case 'locked': return { message: '验证失败次数过多，请稍后再试。', status: 429 };
    case 'rate_limited': return { message: '验证请求过于频繁，请稍后再试。', status: 429 };
    default: return { message: '验证码错误。', status: 400 };
  }
}

export async function GET() {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  try {
    return NextResponse.json(await getSecurityStepUpAvailability(user.id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[security.step-up.availability] failed:', error instanceof Error ? error.message : 'unknown');
    return errorResponse('可用的验证方式暂时无法读取', 503);
  }
}

export async function POST(request: Request) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const body = await request.json().catch(() => null) as {
    action?: unknown;
    method?: unknown;
    challengeId?: unknown;
    code?: unknown;
  } | null;
  const action = body?.action;
  const method = body?.method;
  const challengeId = typeof body?.challengeId === 'string' ? body.challengeId.trim() : '';
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!isSecurityStepUpAction(action)) return errorResponse('无效的安全操作', 400);
  if (!isSecurityStepUpMethod(method)) return errorResponse('无效的验证方式', 400);
  if (!user.sessionId) return errorResponse('当前会话无法进行身份确认', 409);

  if (!challengeId && !code) {
    try {
      const result = await startSecurityStepUp({
        userId: user.id,
        sessionId: user.sessionId,
        action,
        method,
        ip: await getRequestIp(),
      });
      if (method === 'totp') {
        if (!result.challengeToken) return errorResponse('身份确认暂时不可用', 503);
        await setMfaChallengeCookie(result.challengeId, result.challengeToken);
      }
      const { challengeToken: _challengeToken, ...publicResult } = result;
      return NextResponse.json(publicResult, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'SECURITY_STEP_UP_RATE_LIMITED') return errorResponse('验证请求过于频繁，请稍后再试。', 429);
      if (message === 'SECURITY_STEP_UP_METHOD_UNAVAILABLE') return errorResponse('该验证方式当前不可用。', 409);
      if (message === 'SECURITY_STEP_UP_DELIVERY_FAILED') return errorResponse('验证码暂时无法发送，请稍后再试。', 503);
      if (message === 'MFA_TOTP_NOT_ENABLED') return errorResponse('尚未设置验证器应用，请选择短信或邮箱验证码。', 409);
      console.error('[security.step-up.start] failed:', message || 'unknown');
      return errorResponse('身份确认暂时不可用', 503);
    }
  }

  if (!challengeId || !code) return errorResponse('请填写验证码', 400);
  const mfaToken = method === 'totp' ? await readMfaChallengeCookie(challengeId) : null;
  const result = await completeSecurityStepUp({
    challengeId,
    userId: user.id,
    sessionId: user.sessionId,
    action,
    method,
    code,
    totpToken: mfaToken,
    ip: await getRequestIp(),
  });
  if ('error' in result) {
    if (result.error === 'expired' || result.error === 'locked') await clearMfaChallengeCookie(challengeId);
    const mapped = mapError(result.error);
    return errorResponse(mapped.message, mapped.status);
  }

  const marked = await markSecuritySessionMfaVerified(user.id, user.sessionId, new Date(result.verifiedAt));
  if (!marked) return errorResponse('当前会话已失效', 401);
  if (method === 'totp') await clearMfaChallengeCookie(challengeId);
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
