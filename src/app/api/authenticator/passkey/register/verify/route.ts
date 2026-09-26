import { NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { isPasskeyEnabled } from '@/lib/security/mfa-config';
import { verifyPasskeyRegistration, type PasskeyRegistrationResponse } from '@/lib/security/passkey-service';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';

export async function POST(request: Request) {
  if (!isPasskeyEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as { response?: PasskeyRegistrationResponse; name?: string; stepUpToken?: string } | null;
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;
  const user = activeUser;
  if (!body?.stepUpToken || !user.sessionId || !(await consumeSecurityStepUpGrant(body.stepUpToken, { userId: user.id, sessionId: user.sessionId, action: 'passkey_add' }))) {
    return NextResponse.json({ error: '安全验证已失效，请重新验证' }, { status: 403 });
  }
  if (!body?.response || typeof body.response !== 'object') return NextResponse.json({ error: '通行密钥验证结果无效' }, { status: 400 });
  try {
    return NextResponse.json({ passkey: await verifyPasskeyRegistration({ userId: user.id, response: body.response, name: body.name }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'PASSKEY_REGISTRATION_EXPIRED') return NextResponse.json({ error: '添加请求已过期，请重新开始' }, { status: 410 });
    if (message === 'PASSKEY_CREDENTIAL_EXISTS') return NextResponse.json({ error: '这把通行密钥已经添加过了' }, { status: 409 });
    if (message === 'PASSKEY_REGISTRATION_INVALID') return NextResponse.json({ error: '通行密钥添加失败，请重试' }, { status: 400 });
    console.error('[passkey.register.verify] failed:', message || 'unknown');
    return NextResponse.json({ error: '通行密钥添加暂时不可用' }, { status: 503 });
  }
}
