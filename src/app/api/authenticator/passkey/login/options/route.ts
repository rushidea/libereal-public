import { NextResponse } from 'next/server';
import { readMfaChallengeCookie } from '@/lib/security/mfa-cookie';
import { isPasskeyEnabled } from '@/lib/security/mfa-config';
import { readMfaLoginChallengeContext } from '@/lib/security/mfa-service';
import { createPasskeyLoginOptions } from '@/lib/security/passkey-service';

export async function POST(request: Request) {
  if (!isPasskeyEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as { challengeId?: string } | null;
  const challengeId = body?.challengeId?.trim() ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return NextResponse.json({ error: '验证请求无效' }, { status: 400 });
  const token = await readMfaChallengeCookie(challengeId);
  const context = token ? readMfaLoginChallengeContext(challengeId, token) : null;
  if (!token || !context) return NextResponse.json({ error: '验证请求已过期，请重新开始' }, { status: 410 });
  try {
    return NextResponse.json(await createPasskeyLoginOptions({ userId: context.userId, challengeId, challengeToken: token }));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'PASSKEY_NOT_REGISTERED') return NextResponse.json({ error: '该账户尚未添加通行密钥' }, { status: 404 });
    if (message === 'PASSKEY_LOGIN_LOCKED') return NextResponse.json({ error: '验证请求已暂时锁定，请稍后再试' }, { status: 429 });
    if (message === 'PASSKEY_LOGIN_EXPIRED') return NextResponse.json({ error: '验证请求已过期，请重新开始' }, { status: 410 });
    console.error('[passkey.login.options] failed:', message || 'unknown');
    return NextResponse.json({ error: '通行密钥登录暂时不可用' }, { status: 503 });
  }
}
