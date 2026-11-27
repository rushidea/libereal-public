import { NextResponse } from 'next/server';
import type { AdminPermissionKey } from './admin-permissions';
import { requireAdmin, type SessionUser } from './session';
import { consumeSecurityStepUpGrant, hasSecurityStepUpGrant } from './security/security-step-up';

/** Extract an explicit one-time MFA grant token from a JSON request body. */
export function extractStepUpToken(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const raw = (body as { stepUpToken?: unknown }).stepUpToken;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

/**
 * Authorize an admin order mutation and fail closed if an explicit stepUpToken
 * is invalid or replayed even when a recent MFA window exists.
 */
export async function authorizeAdminOrderMutation(
  permission: AdminPermissionKey,
  stepUpToken?: string,
): Promise<SessionUser | NextResponse> {
  const admin = stepUpToken
    ? await requireAdmin(permission, { token: stepUpToken, action: 'admin_sensitive' })
    : await requireAdmin(permission);
  if (admin instanceof NextResponse) return admin;
  if (stepUpToken) {
    const valid = Boolean(
      admin.sessionId
      && await hasSecurityStepUpGrant(stepUpToken, {
        userId: admin.id,
        sessionId: admin.sessionId,
        action: 'admin_sensitive',
      }),
    );
    if (!valid) {
      return NextResponse.json({ error: 'Admin MFA required' }, { status: 403 });
    }
  }
  return admin;
}

/** Consume an explicit one-time admin_sensitive grant right before committing mutations. */
export async function consumeAdminOrderStepUp(
  admin: SessionUser,
  stepUpToken?: string,
): Promise<NextResponse | null> {
  if (!stepUpToken) return null;
  const consumed = Boolean(
    admin.sessionId
    && await consumeSecurityStepUpGrant(stepUpToken, {
      userId: admin.id,
      sessionId: admin.sessionId,
      action: 'admin_sensitive',
    }),
  );
  if (!consumed) {
    return NextResponse.json({ error: 'Admin MFA required' }, { status: 403 });
  }
  return null;
}
