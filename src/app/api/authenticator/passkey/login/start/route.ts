import { NextResponse } from 'next/server';
import { isPasskeyEnabled } from '@/lib/security/mfa-config';
import { getRequestIp } from '@/lib/security/mfa-rate-limit';
import { setMfaChallengeCookie } from '@/lib/security/mfa-cookie';
import { createPasskeyLoginChallenge } from '@/lib/security/passkey-service';

export async function POST(request: Request) {
  if (!isPasskeyEnabled()) return NextResponse.json({ error: '通行密钥登录暂时不可用' }, { status: 404 });

  const body = await request.json().catch(() => null) as { email?: string } | null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: '请输入有效邮箱' }, { status: 400 });
  }

  try {
    const challenge = await createPasskeyLoginChallenge({ email, ip: await getRequestIp() });
    await setMfaChallengeCookie(challenge.challengeId, challenge.challengeToken);
    return NextResponse.json({ challengeId: challenge.challengeId });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'PASSKEY_LOGIN_USER_NOT_FOUND') return NextResponse.json({ error: '该邮箱未设置 Passkey' }, { status: 404 });
    if (message === 'MFA_CHALLENGE_RATE_LIMITED') return NextResponse.json({ error: '通行密钥登录请求过于频繁，请稍后再试' }, { status: 429 });
    console.error('[passkey.login.start] failed:', message || 'unknown');
    return NextResponse.json({ error: '通行密钥登录暂时不可用' }, { status: 503 });
  }
}
