import { NextResponse } from 'next/server';
import { requiresAdminMfaForPermission } from '@/lib/admin-mfa-settings';
import { requireAdmin, type SessionUser } from '@/lib/session';
import { isMfaAdminRequired, isMfaPhase1Enabled } from '@/lib/security/mfa-config';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';

export async function requireAdminPricingRead(_stepUpToken?: string): Promise<SessionUser | NextResponse> {
  return requireAdmin('pricing.write', { skipStepUp: true });
}

export async function requireAdminPricingMutation(stepUpToken?: string): Promise<SessionUser | NextResponse> {
  const admin = await requireAdmin('pricing.write', { skipStepUp: true });
  if (admin instanceof NextResponse) return admin;

  const mustStepUp = isMfaAdminRequired()
    || isMfaPhase1Enabled()
    || await requiresAdminMfaForPermission('pricing.write');
  if (!mustStepUp) return admin;

  const token = stepUpToken?.trim() || '';
  if (!token || !admin.sessionId || !(await consumeSecurityStepUpGrant(
    token,
    { userId: admin.id, sessionId: admin.sessionId, action: 'admin_sensitive' },
  ))) {
    return NextResponse.json({ error: 'Admin MFA required' }, { status: 403 });
  }

  return admin;
}
