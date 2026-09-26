import { NextResponse } from 'next/server';
import { readMfaChallengeCookie } from '@/lib/security/mfa-cookie';
import { isPasskeyEnabled } from '@/lib/security/mfa-config';
import { getRequestIp } from '@/lib/security/mfa-rate-limit';
import { readMfaLoginChallengeContext } from '@/lib/security/mfa-service';
import { verifyPasskeyLogin, type PasskeyAuthenticationResponse } from '@/lib/security/passkey-service';

export async function POST(request: Request) {
  if (!isPasskeyEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as { challengeId?: string; response?: PasskeyAuthenticationResponse } | null;
  const challengeId = body?.challengeId?.trim() ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !body?.response || typeof body.response !== 'object') {
    return NextResponse.json({ error: '通行密钥验证结果无效' }, { status: 400 });
  }
  const token = await readMfaChallengeCookie(challengeId);
  const context = token ? readMfaLoginChallengeContext(challengeId, token) : null;
  if (!token || !context) return NextResponse.json({ error: '验证请求已过期，请重新开始' }, { status: 410 });
  try {
    const result = await verifyPasskeyLogin({
      userId: context.userId,
      provider: context.provider,
      challengeId,
      challengeToken: token,
      response: body.response,
      ip: await getRequestIp(),
    });
    return NextResponse.json({ passkeyToken: result.passkeyToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'PASSKEY_RATE_LIMITED') return NextResponse.json({ error: '验证次数过多，请稍后再试' }, { status: 429 });
    if (message === 'PASSKEY_LOGIN_LOCKED') return NextResponse.json({ error: '验证请求已暂时锁定，请稍后再试' }, { status: 429 });
    if (message === 'PASSKEY_COUNTER_REPLAY') return NextResponse.json({ error: '通行密钥状态异常，请在账户安全中重新添加' }, { status: 401 });
    if (message === 'PASSKEY_CREDENTIAL_NOT_FOUND') return NextResponse.json({ error: '未找到已添加的通行密钥' }, { status: 401 });
    if (message === 'PASSKEY_LOGIN_EXPIRED') return NextResponse.json({ error: '验证请求已过期，请重新开始' }, { status: 410 });
    return NextResponse.json({ error: '通行密钥验证失败，请重试' }, { status: 401 });
  }
}
