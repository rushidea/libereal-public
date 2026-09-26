import { NextRequest, NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { rateLimitAsync } from '@/lib/rateLimit';
import { isAdminMfaScenarioEnabled } from '@/lib/admin-mfa-settings';
import {
  organizationRbacErrorStatus,
  OrganizationRbacError,
  requestOrganizationRoleChange,
  requireOrganizationPermission,
  updateOrganizationMemberPermissions,
} from '@/lib/organization-service';
import { consumeSecurityStepUpGrant, hasSecurityStepUpGrant } from '@/lib/security/security-step-up';

type RouteParams = { params: Promise<{ id: string; memberId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const permissionsMfaEnabled = await isAdminMfaScenarioEnabled('organization.permissions');
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式无效' }, { status: 400 });
  }
  const stepUpToken = typeof body === 'object' && body !== null && 'stepUpToken' in body && typeof body.stepUpToken === 'string'
    ? body.stepUpToken.trim()
    : '';
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  if (permissionsMfaEnabled) {
    if (!user.sessionId || !stepUpToken || !(await hasSecurityStepUpGrant(stepUpToken, { userId: user.id, sessionId: user.sessionId, action: 'organization_permissions' }))) {
      return NextResponse.json({ error: 'MFA required' }, { status: 403 });
    }
  }
  const { id, memberId } = await params;
  const limit = await rateLimitAsync(`organization:role-change:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: '角色变更请求过于频繁，请稍后重试。', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.resetIn / 1000)) } },
    );
  }

  const role = typeof body === 'object' && body !== null && 'role' in body ? body.role : undefined;
  const permissions = typeof body === 'object' && body !== null && 'permissions' in body ? body.permissions : undefined;

  try {
    await requireOrganizationPermission(user.id, id, 'organization.members.manage');
    if (permissionsMfaEnabled && stepUpToken && user.sessionId && !(await consumeSecurityStepUpGrant(stepUpToken, { userId: user.id, sessionId: user.sessionId, action: 'organization_permissions' }))) {
      return NextResponse.json({ error: '安全验证已失效，请重新验证' }, { status: 403 });
    }
    if (permissions !== undefined) {
      const member = await updateOrganizationMemberPermissions(user.id, id, memberId, permissions);
      return NextResponse.json({ member });
    }
    const roleRequest = await requestOrganizationRoleChange(user.id, id, memberId, role);
    return NextResponse.json({ request: roleRequest }, { status: 201 });
  } catch (error) {
    if (error instanceof OrganizationRbacError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: organizationRbacErrorStatus(error) });
    }
    console.error('[organizations.members.role-change] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '角色变更提交失败' }, { status: 500 });
  }
}
