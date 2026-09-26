import { NextRequest, NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { rateLimitAsync } from '@/lib/rateLimit';
import {
  organizationRbacErrorStatus,
  OrganizationRbacError,
  reviewOrganizationApproval,
  requireOrganizationPermission,
  type OrganizationApprovalAction,
} from '@/lib/organization-service';

type RouteParams = { params: Promise<{ id: string; approvalId: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const { id, approvalId } = await params;
  const limit = await rateLimitAsync(`organization:approval-review:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: '审批请求过于频繁，请稍后重试。', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.resetIn / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式无效' }, { status: 400 });
  }
  const action = typeof body === 'object' && body !== null && 'action' in body ? body.action : undefined;

  try {
    await requireOrganizationPermission(user.id, id, 'organization.approvals.review');
    return NextResponse.json({ approval: await reviewOrganizationApproval(user.id, id, approvalId, action as OrganizationApprovalAction) });
  } catch (error) {
    if (error instanceof OrganizationRbacError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: organizationRbacErrorStatus(error) });
    }
    console.error('[organizations.approvals.review] failed:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '审核操作失败' }, { status: 500 });
  }
}
