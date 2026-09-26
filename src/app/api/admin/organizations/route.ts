import { NextResponse } from 'next/server';
import { getAdminPermissions, requireAdmin } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';
import {
  getOrganizationCreationSetting,
  listOrganizationCreationAccess,
  ensurePendingOrganizationApprovalNotifications,
  listOrganizationsPendingApproval,
  setOrganizationCreationGrant,
} from '@/lib/organization-service';

export async function GET(request: Request) {
  const admin = await requireAdmin('organizations.read');
  if (admin instanceof NextResponse) return admin;

  try {
    const search = new URL(request.url).searchParams.get('q') || '';
    await ensurePendingOrganizationApprovalNotifications();
    const [organizations, permissions] = await Promise.all([
      listOrganizationsPendingApproval(),
      getAdminPermissions(admin),
    ]);
    const creationAccess = permissions.includes('organizations.write')
      ? await listOrganizationCreationAccess(search)
      : { grants: [], candidates: [] };
    return NextResponse.json({
      organizations,
      organizationCreationGrants: creationAccess.grants.map((grant) => ({
        ...grant,
        grantedAt: grant.grantedAt.toISOString(),
      })),
      organizationCreationCandidates: creationAccess.candidates,
      canManageOrganizationCreation: permissions.includes('organizations.write'),
    });
  } catch (error) {
    console.error('[admin.organizations.list] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '组织审核列表暂时不可用' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const admin = await requireAdmin('organizations.write');
  if (admin instanceof NextResponse) return admin;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式无效' }, { status: 400 });
  }
  const targetUserId = typeof body === 'object' && body !== null && 'userId' in body && typeof body.userId === 'string'
    ? body.userId
    : '';
  const allowed = typeof body === 'object' && body !== null && 'allowed' in body
    ? body.allowed
    : undefined;
  if (!targetUserId || typeof allowed !== 'boolean') {
    return NextResponse.json({ error: '指定用户和授权状态无效' }, { status: 400 });
  }

  try {
    const result = await setOrganizationCreationGrant(targetUserId, admin.id, allowed);
    await writeAuditLog({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'organization.creation_permission_changed',
      resource: 'organizations',
      targetType: 'User',
      targetId: targetUserId,
      before: { allowed: !allowed },
      after: { allowed },
      reason: '后台组织创建权限调整',
    });
    return NextResponse.json({
      userId: targetUserId,
      allowed,
      result,
    });
  } catch (error) {
    console.error('[admin.organizations.setting] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '组织创建权限保存失败' }, { status: 500 });
  }
}
