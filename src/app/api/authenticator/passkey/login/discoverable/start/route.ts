import { NextResponse } from 'next/server';
import { isPasskeyEnabled } from '@/lib/security/mfa-config';
import { getRequestIp } from '@/lib/security/mfa-rate-limit';
import { createDiscoverablePasskeyLoginOptions } from '@/lib/security/passkey-service';

export async function POST() {
  if (!isPasskeyEnabled()) return NextResponse.json({ error: '通行密钥登录暂时不可用' }, { status: 404 });
  try {
    const result = await createDiscoverablePasskeyLoginOptions({ ip: await getRequestIp() });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'PASSKEY_RATE_LIMITED') return NextResponse.json({ error: '通行密钥登录请求过于频繁，请稍后再试' }, { status: 429 });
    console.error('[passkey.login.discoverable.start] failed:', message || 'unknown');
    return NextResponse.json({ error: '通行密钥登录暂时不可用' }, { status: 503 });
  }
}
