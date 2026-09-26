import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import {
  organizationRbacErrorStatus,
  OrganizationRbacError,
  reviewOrganizationCreation,
  type OrganizationCreationReviewAction,
} from '@/lib/organization-service';

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const admin = await requireAdmin('organizations.write');
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式无效' }, { status: 400 });
  }
  const action = typeof body === 'object' && body !== null && 'action' in body ? body.action : undefined;

  try {
    return NextResponse.json({ organization: await reviewOrganizationCreation(admin.id, id, action as OrganizationCreationReviewAction) });
  } catch (error) {
    if (error instanceof OrganizationRbacError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: organizationRbacErrorStatus(error) });
    }
    console.error('[admin.organizations.review] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '组织审核操作失败' }, { status: 500 });
  }
}
