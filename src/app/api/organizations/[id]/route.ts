import { NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { sendAdminOperationalEmail } from '@/lib/mail';
import {
  organizationRbacErrorStatus,
  OrganizationRbacError,
  deleteRejectedOrganization,
  requireOrganizationPermission,
  updateOrganizationProfile,
} from '@/lib/organization-service';

type RouteParams = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteParams) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const { id } = await params;

  try {
    return NextResponse.json({ organization: await deleteRejectedOrganization(user.id, id) });
  } catch (error) {
    if (error instanceof OrganizationRbacError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: organizationRbacErrorStatus(error) });
    }
    console.error('[organizations.delete] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '组织删除失败' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const { id } = await params;

  try {
    await requireOrganizationPermission(user.id, id, 'organization.profile.edit');
    const body: unknown = await request.json();
    const organization = await updateOrganizationProfile(user.id, id, { name: typeof body === 'object' && body !== null && 'name' in body ? body.name : undefined });
    sendAdminOperationalEmail({
      subject: 'LIBEREAL · 组织名称修改审核申请',
      message: `组织“${organization.name}”申请修改为“${organization.pendingName || '新名称'}”，请前往组织审核处理。`,
      path: '/admin/organizations',
    });
    return NextResponse.json({ organization });
  } catch (error) {
    if (error instanceof OrganizationRbacError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: organizationRbacErrorStatus(error) });
    }
    if (error instanceof SyntaxError) return NextResponse.json({ error: '请求格式无效' }, { status: 400 });
    console.error('[organizations.profile.update] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '组织资料修改失败' }, { status: 500 });
  }
}
