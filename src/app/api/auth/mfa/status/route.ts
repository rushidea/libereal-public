import { NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { isMfaPhase1Enabled } from '@/lib/security/mfa-config';
import { getMfaStatus } from '@/lib/security/mfa-service';

export async function GET() {
  if (!isMfaPhase1Enabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;

  try {
    return NextResponse.json(getMfaStatus(user.id));
  } catch (error) {
    console.error('[mfa.status] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'MFA status unavailable' }, { status: 503 });
  }
}
