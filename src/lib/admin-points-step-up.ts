import { NextResponse } from 'next/server';
import { requireAdmin, type SessionUser } from '@/lib/session';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';

/** 需要变更积分余额的管理员操作统一使用一次性身份确认凭证。 */
export async function requireAdminPointsMutation(stepUpToken?: string): Promise<SessionUser | NextResponse> {
  const admin = await requireAdmin('points.write', {
    token: stepUpToken,
    action: 'admin_sensitive',
  });
  if (admin instanceof NextResponse) return admin;

  if (stepUpToken && (!admin.sessionId || !(await consumeSecurityStepUpGrant(
    stepUpToken,
    { userId: admin.id, sessionId: admin.sessionId, action: 'admin_sensitive' },
  )))) {
    return NextResponse.json({ error: '安全验证已失效，请重新验证' }, { status: 403 });
  }

  return admin;
}
