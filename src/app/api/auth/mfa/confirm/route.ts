import { NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { isMfaPhase1Enabled } from '@/lib/security/mfa-config';
import { getRequestIp } from '@/lib/security/mfa-rate-limit';
import { confirmMfaSetup } from '@/lib/security/mfa-service';

export async function POST(request: Request) {
  if (!isMfaPhase1Enabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;

  const body = await request.json().catch(() => null) as { code?: string } | null;
  const code = body?.code?.trim() ?? '';
  if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: 'Invalid MFA code' }, { status: 400 });
  const ip = await getRequestIp();

  try {
    return NextResponse.json(await confirmMfaSetup(user.id, code, ip));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'MFA_SETUP_RATE_LIMITED') return NextResponse.json({ error: 'MFA setup attempts exceeded' }, { status: 429 });
    if (message === 'MFA_CODE_INVALID') return NextResponse.json({ error: 'Invalid MFA code' }, { status: 400 });
    if (message === 'MFA_ALREADY_ENABLED') return NextResponse.json({ error: 'MFA already enabled' }, { status: 409 });
    if (message === 'MFA_SETUP_NOT_STARTED') return NextResponse.json({ error: 'MFA setup not started' }, { status: 400 });
    console.error('[mfa.confirm] failed:', message || 'unknown');
    return NextResponse.json({ error: 'MFA confirmation unavailable' }, { status: 503 });
  }
}
