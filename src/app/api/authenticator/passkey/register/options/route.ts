import { NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { isPasskeyEnabled } from '@/lib/security/mfa-config';
import { getRequestIp } from '@/lib/security/mfa-rate-limit';
import { createPasskeyRegistrationOptions } from '@/lib/security/passkey-service';
import { hasSecurityStepUpGrant } from '@/lib/security/security-step-up';

export async function POST(request: Request) {
  if (!isPasskeyEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;
  const body = await request.json().catch(() => null) as { stepUpToken?: string } | null;
  const user = activeUser;
  if (!body?.stepUpToken || !user.sessionId || !(await hasSecurityStepUpGrant(body.stepUpToken, { userId: user.id, sessionId: user.sessionId, action: 'passkey_add' }))) {
    return NextResponse.json({ error: '安全验证已失效，请重新验证' }, { status: 403 });
  }
  try {
    return NextResponse.json(await createPasskeyRegistrationOptions({
      userId: user.id,
      email: user.email,
      name: user.name,
      ip: await getRequestIp(),
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'PASSKEY_REGISTRATION_RATE_LIMITED') return NextResponse.json({ error: '添加通行密钥的请求过于频繁，请稍后再试' }, { status: 429 });
    console.error('[passkey.register.options] failed:', message || 'unknown');
    return NextResponse.json({ error: '通行密钥添加暂时不可用' }, { status: 503 });
  }
}
