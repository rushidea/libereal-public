// 统一的 session 访问 helpers —— 替代散落各处的 `(session.user as DbUser).xxx` 强转
//
// 用法：
//   const user = await requireAdmin();
//   if (user instanceof NextResponse) return user;
//   // use user.id, user.email, user.role

import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { auth } from './auth';
import { prisma } from './prisma';
import { isAdminEmail } from './auth-helpers';
import { ADMIN_PERMISSION_KEYS, type AdminPermissionKey } from './admin-permissions';
import { requiresAdminMfaForPermission } from './admin-mfa-settings';
import { isMfaAdminRequired, MFA_RECENT_WINDOW_MS } from './security/mfa-config';
import { getAdminMfaPolicy } from './security/admin-mfa-policy';
import { hasSecurityStepUpGrant, type SecurityStepUpAction } from './security/security-step-up';
import { getSecuritySessionState, getSecuritySessionStateDetailed, getSecurityRequestMetadata, hasRecentSecuritySessionMfa, registerSecuritySession, touchSecuritySession } from './security/security-session-service';

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  authLevel?: 'primary_verified' | 'mfa_verified';
  mfaVerifiedAt?: number | null;
  mfaMethod?: 'totp' | 'recovery' | 'passkey' | null;
  sessionId?: string | null;
}

export async function requireUser(): Promise<SessionUser | NextResponse> {
  const session: Session | null = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  return session.user as SessionUser;
}

export async function requireMfaUser(): Promise<SessionUser | NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  if (user.authLevel !== 'mfa_verified') {
    return NextResponse.json({ error: 'MFA required' }, { status: 403 });
  }
  return user;
}

export async function requireActiveSession(): Promise<SessionUser | NextResponse> {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  // 旧 JWT 没有可吊销的服务端会话记录，继续放行会绕过会话撤销。
  // 强制重新登录后签发带 sessionId 的新 JWT。
  if (!user.sessionId) {
    return NextResponse.json({ error: '会话已更新，请重新登录' }, { status: 401 });
  }
  const state = await getSecuritySessionState(user.id, user.sessionId);
  if (!state.known) {
    await registerSecuritySession({
      userId: user.id,
      sessionId: user.sessionId,
      metadata: await getSecurityRequestMetadata(user.id),
    });
    return user;
  }
  if (!state.active) {
    const detail = await getSecuritySessionStateDetailed(user.id, user.sessionId);
    return NextResponse.json({ error: detail === 'expired' ? 'Session expired' : 'Session revoked' }, { status: 401 });
  }
  await touchSecuritySession(user.id, user.sessionId);
  return user;
}

export async function requireRecentMfaUser(): Promise<SessionUser | NextResponse> {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const now = Date.now();
  const jwtRecent = user.authLevel === 'mfa_verified' && Boolean(user.mfaVerifiedAt) && now - user.mfaVerifiedAt! <= MFA_RECENT_WINDOW_MS;
  if (jwtRecent) return user;
  if (user.sessionId && await hasRecentSecuritySessionMfa(user.id, user.sessionId)) return user;
  return NextResponse.json({ error: user.authLevel === 'mfa_verified' ? 'Recent MFA verification required' : 'MFA required' }, { status: 403 });
}

export async function requireRecentActiveMfaUser(): Promise<SessionUser | NextResponse> {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  if (user.authLevel !== 'mfa_verified') {
    return NextResponse.json({ error: 'MFA required' }, { status: 403 });
  }
  if (!user.mfaVerifiedAt || Date.now() - user.mfaVerifiedAt > MFA_RECENT_WINDOW_MS) {
    return NextResponse.json({ error: 'Recent MFA verification required' }, { status: 403 });
  }
  return user;
}

export async function getAdminPermissions(user: SessionUser): Promise<AdminPermissionKey[]> {
  if (user.role !== 'admin') return [];
  if (isAdminEmail(user.email)) return [...ADMIN_PERMISSION_KEYS];

  const assignments = await prisma.adminUserRole.findMany({
    where: { userId: user.id },
    select: { role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } } },
  });
  if (assignments.some((assignment) => assignment.role.key === 'super_admin')) return [...ADMIN_PERMISSION_KEYS];

  const keys = new Set(assignments.flatMap((assignment) => assignment.role.permissions.map((item) => item.permission.key)));
  return ADMIN_PERMISSION_KEYS.filter((key) => keys.has(key));
}

export async function requireAdminStepUp(user: SessionUser): Promise<SessionUser | NextResponse> {
  if (!isMfaAdminRequired()) return user;

  const jwtRecent = user.authLevel === 'mfa_verified' && Boolean(user.mfaVerifiedAt) && Date.now() - user.mfaVerifiedAt! <= MFA_RECENT_WINDOW_MS;
  const sessionRecent = !jwtRecent && user.sessionId ? await hasRecentSecuritySessionMfa(user.id, user.sessionId) : false;
  if (!jwtRecent && !sessionRecent) {
    return NextResponse.json({ error: 'Admin MFA required', redirect: '/account/security' }, { status: 403 });
  }

  try {
    const policy = await getAdminMfaPolicy(user.id, user.email, true);
    if (!policy.satisfied) {
      return NextResponse.json({ error: 'Admin authenticator policy required', redirect: '/account/security' }, { status: 403 });
    }
  } catch (error) {
    console.error('[session.admin-mfa] state check failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Admin MFA state unavailable' }, { status: 503 });
  }
  return user;
}

export async function requireAdmin(permission?: AdminPermissionKey, stepUp?: { token?: string; action?: SecurityStepUpAction; skipStepUp?: boolean }): Promise<SessionUser | NextResponse> {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (permission && !stepUp?.skipStepUp && await requiresAdminMfaForPermission(permission)) {
    const hasGrant = Boolean(stepUp?.token && stepUp.action && user.sessionId && await hasSecurityStepUpGrant(stepUp.token, { userId: user.id, sessionId: user.sessionId, action: stepUp.action }));
    if (!hasGrant) {
      const required = await requireAdminStepUp(user);
      if (required instanceof NextResponse) return required;
    }
  }
  if (permission) {
    const permissions = await getAdminPermissions(user);
    if (!permissions.includes(permission)) {
      return NextResponse.json({ error: 'Forbidden', requiredPermission: permission }, { status: 403 });
    }
  }
  return user;
}
