import { NextRequest, NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { rateLimitAsync } from '@/lib/rateLimit';
import {
  inviteOrganizationMember,
  listOrganizationMembers,
  organizationRbacErrorStatus,
  OrganizationRbacError,
  requireOrganizationMemberManager,
} from '@/lib/organization-service';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const { id } = await params;

  try {
    await requireOrganizationMemberManager(user.id, id);
    return NextResponse.json({ members: await listOrganizationMembers(id) });
  } catch (error) {
    if (error instanceof OrganizationRbacError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: organizationRbacErrorStatus(error) });
    }
    console.error('[organizations.members.list] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '成员列表暂时不可用' }, { status: 503 });
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const limit = await rateLimitAsync(`organization:invite:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: '成员邀请请求过于频繁，请稍后重试。', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.resetIn / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式无效' }, { status: 400 });
  }
  const email = typeof body === 'object' && body !== null && 'email' in body && typeof body.email === 'string'
    ? body.email
    : '';
  const role = typeof body === 'object' && body !== null && 'role' in body ? body.role : undefined;

  try {
    await requireOrganizationMemberManager(user.id, id);
    return NextResponse.json({ invitation: await inviteOrganizationMember(user.id, id, email, role) }, { status: 201 });
  } catch (error) {
    if (error instanceof OrganizationRbacError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: organizationRbacErrorStatus(error) });
    }
    console.error('[organizations.members.invite] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '成员邀请提交失败' }, { status: 500 });
  }
}
