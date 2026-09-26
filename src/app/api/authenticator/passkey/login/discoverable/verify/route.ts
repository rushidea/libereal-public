import { NextResponse } from 'next/server';
import { isPasskeyEnabled } from '@/lib/security/mfa-config';
import { getRequestIp } from '@/lib/security/mfa-rate-limit';
import { setMfaChallengeCookie } from '@/lib/security/mfa-cookie';
import { verifyDiscoverablePasskeyLogin, type PasskeyAuthenticationResponse } from '@/lib/security/passkey-service';

export async function POST(request: Request) {
  if (!isPasskeyEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as { challengeId?: string; response?: PasskeyAuthenticationResponse } | null;
  const challengeId = body?.challengeId?.trim() ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !body?.response || typeof body.response !== 'object') {
    return NextResponse.json({ error: 'Invalid passkey response' }, { status: 400 });
  }
  try {
    const result = await verifyDiscoverablePasskeyLogin({
      challengeId,
      response: body.response,
      ip: await getRequestIp(),
    });
    await setMfaChallengeCookie(result.challengeId, result.challengeToken);
    return NextResponse.json({ challengeId: result.challengeId, passkeyToken: result.passkeyToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'PASSKEY_RATE_LIMITED') return NextResponse.json({ error: '通行密钥登录请求过于频繁，请稍后再试' }, { status: 429 });
    if (message === 'PASSKEY_CREDENTIAL_NOT_FOUND') return NextResponse.json({ error: '未找到可用的通行密钥' }, { status: 401 });
    if (message === 'PASSKEY_COUNTER_REPLAY') return NextResponse.json({ error: '通行密钥状态异常，请在账户安全中重新添加' }, { status: 401 });
    if (message === 'PASSKEY_LOGIN_EXPIRED') return NextResponse.json({ error: '验证请求已过期，请重新开始' }, { status: 410 });
    console.error('[passkey.login.discoverable.verify] failed:', message || 'unknown');
    return NextResponse.json({ error: '通行密钥验证失败，请重试' }, { status: 401 });
  }
}
