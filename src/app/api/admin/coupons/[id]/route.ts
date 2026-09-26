import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

/**
 * 优惠券二次授权审批（落地 5 安全红线）：
 * - PATCH /api/admin/coupons/[id]：模板审批（approve/reject）——无门槛券模板生成后需授权；
 * - PATCH /api/admin/coupons/instances/[id]：实例发放审批——无门槛券发放后需授权。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin('pricing.write');
  if (user instanceof NextResponse) return user;

  const { id } = await params;
  const { action, type } = await request.json().catch(() => ({}));
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action 必须是 approve 或 reject' }, { status: 400 });
  }

  try {
    if (type === 'instance') {
      const inst = await prisma.couponInstance.findUnique({ where: { id } });
      if (!inst) return NextResponse.json({ error: '券实例不存在' }, { status: 404 });
      if (action === 'approve') {
        // 安全红线：仅「待授权（pending）」实例可审批通过。
        // 已生效/已使用/已作废的券一律不可重新启用（防止已核销券复活二次消费）。
        if (inst.issueApprovalStatus === 'approved') {
          return NextResponse.json({ error: '该券实例已审批通过，无需重复操作' }, { status: 400 });
        }
        if (inst.status !== 'pending') {
          return NextResponse.json({ error: '仅待授权的券实例可审批通过（当前状态不可重新启用）' }, { status: 400 });
        }
      } else if (inst.status === 'used') {
        // 已核销的券不可驳回（核销记录与订单绑定，避免审计链路断裂）
        return NextResponse.json({ error: '该券已使用，不可驳回' }, { status: 400 });
      }
      await prisma.couponInstance.update({
        where: { id },
        data: {
          issueApprovalStatus: action === 'approve' ? 'approved' : 'rejected',
          status: action === 'approve' ? 'active' : 'revoked',
          approvedBy: action === 'approve' ? user.id ?? null : undefined,
          approvedAt: action === 'approve' ? new Date() : undefined,
        },
      });
      return NextResponse.json({ success: true, message: action === 'approve' ? '券已授权发放' : '券已驳回' });
    }

    // 模板审批
    const coupon = await prisma.coupon.findUnique({ where: { id } });
    if (!coupon) return NextResponse.json({ error: '券模板不存在' }, { status: 404 });
    await prisma.coupon.update({
      where: { id },
      data: {
        approvalStatus: action === 'approve' ? 'approved' : 'rejected',
        approvedBy: user.id ?? null,
        approvedAt: new Date(),
      },
    });
    return NextResponse.json({ success: true, message: action === 'approve' ? '券模板已授权' : '券模板已驳回' });
  } catch (err) {
    console.error('[admin/coupons PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
