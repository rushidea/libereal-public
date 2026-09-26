import { NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { isMfaPhase1Enabled } from '@/lib/security/mfa-config';
import { getRequestIp } from '@/lib/security/mfa-rate-limit';
import { disableMfa } from '@/lib/security/mfa-service';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';

export async function POST(request: Request) {
  if (!isMfaPhase1Enabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const body = await request.json().catch(() => null) as { stepUpToken?: string } | null;
  if (!user.sessionId || !body?.stepUpToken || !(await consumeSecurityStepUpGrant(body.stepUpToken, { userId: user.id, sessionId: user.sessionId, action: 'mfa_disable' }))) {
    return NextResponse.json({ error: '安全验证已失效，请重新验证' }, { status: 403 });
  }

  try {
    const ip = await getRequestIp();
    disableMfa(user.id, ip);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'MFA_NOT_ENABLED') {
      return NextResponse.json({ error: 'MFA is not enabled' }, { status: 409 });
    }
    if (message === 'MFA_OTHER_AUTHENTICATOR_REQUIRED') {
      return NextResponse.json({ error: '请先保留一个 Passkey 或其他有效验证器' }, { status: 409 });
    }
    console.error('[mfa.disable] failed:', message || 'unknown');
    return NextResponse.json({ error: 'MFA disable unavailable' }, { status: 503 });
  }
}
