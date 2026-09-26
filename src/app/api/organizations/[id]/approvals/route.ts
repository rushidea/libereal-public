import { NextRequest, NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import {
  listOrganizationApprovals,
  organizationRbacErrorStatus,
  OrganizationRbacError,
  requireOrganizationPermission,
} from '@/lib/organization-service';

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const { id } = await params;

  try {
    await requireOrganizationPermission(user.id, id, 'organization.approvals.review');
    return NextResponse.json({ approvals: await listOrganizationApprovals(user.id, id) });
  } catch (error) {
    if (error instanceof OrganizationRbacError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: organizationRbacErrorStatus(error) });
    }
    console.error('[organizations.approvals.list] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '审核列表暂时不可用' }, { status: 503 });
  }
}
