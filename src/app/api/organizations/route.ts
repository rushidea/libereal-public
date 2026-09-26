import { NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { rateLimitAsync } from '@/lib/rateLimit';
import { sendAdminOperationalEmail } from '@/lib/mail';
import {
  createOrganization,
  canUserCreateOrganization,
  listOrganizationInvitationsForUser,
  listOrganizationsForUser,
  organizationRbacErrorStatus,
  OrganizationRbacError,
} from '@/lib/organization-service';

export async function GET() {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;

  try {
    const [organizations, invitations, canCreateOrganization] = await Promise.all([
      listOrganizationsForUser(user.id),
      listOrganizationInvitationsForUser(user.id),
      canUserCreateOrganization(user.id),
    ]);
    return NextResponse.json({ organizations, invitations, canCreateOrganization });
  } catch (error) {
    console.error('[organizations.list] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '组织列表暂时不可用' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const limit = await rateLimitAsync(`organization:create:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: '组织创建请求过于频繁，请稍后重试。', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.resetIn / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式无效' }, { status: 400 });
  }
  const name = typeof body === 'object' && body !== null && 'name' in body && typeof body.name === 'string'
    ? body.name
    : '';

  try {
    const organization = await createOrganization(user.id, name);
    sendAdminOperationalEmail({
      subject: 'LIBEREAL · 新组织审核申请',
      message: `组织“${organization.name}”已提交创建申请，请前往组织审核处理。`,
      path: '/admin/organizations',
    });
    return NextResponse.json({ organization }, { status: 201 });
  } catch (error) {
    if (error instanceof OrganizationRbacError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: organizationRbacErrorStatus(error) });
    }
    console.error('[organizations.create] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '组织创建失败' }, { status: 500 });
  }
}
