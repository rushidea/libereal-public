import { NextResponse } from 'next/server';
import { rateLimitAsync } from '@/lib/rateLimit';
import { requireActiveSession } from '@/lib/session';
import {
  leaveOrganization,
  organizationRbacErrorStatus,
  OrganizationRbacError,
} from '@/lib/organization-service';

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const limit = await rateLimitAsync(`organization:leave:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: '退出组织请求过于频繁，请稍后重试。', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.resetIn / 1000)) } },
    );
  }
  const { id } = await params;

  try {
    return NextResponse.json({ membership: await leaveOrganization(user.id, id) });
  } catch (error) {
    if (error instanceof OrganizationRbacError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: organizationRbacErrorStatus(error) });
    }
    console.error('[organizations.leave] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '退出组织失败' }, { status: 500 });
  }
}
