import { NextResponse } from 'next/server';
import { requireActiveSession, requireRecentMfaUser } from '@/lib/session';
import { isMfaPhase1Enabled } from '@/lib/security/mfa-config';
import { createMfaSetup, verifyMfaSetupPassword } from '@/lib/security/mfa-service';

export async function POST(request: Request) {
  if (!isMfaPhase1Enabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const body = await request.json().catch(() => null) as { password?: string } | null;
  const recentMfaUser = await requireRecentMfaUser();
  const hasRecentMfa = !(recentMfaUser instanceof NextResponse);
  if (!hasRecentMfa && !(await verifyMfaSetupPassword(user.id, body?.password?.trim() ?? ''))) {
    return NextResponse.json({ error: 'Password confirmation required' }, { status: 403 });
  }

  try {
    return NextResponse.json(createMfaSetup(user.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (message === 'MFA_ALREADY_ENABLED') {
      return NextResponse.json({ error: 'MFA is already enabled' }, { status: 409 });
    }
    console.error('[mfa.setup] failed:', message || 'unknown');
    return NextResponse.json({ error: 'MFA setup unavailable' }, { status: 503 });
  }
}
