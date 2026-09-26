import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminStepUp } from '@/lib/session';
import { isAdminMfaScenarioEnabled } from '@/lib/admin-mfa-settings';
import { refundOrderPointsProportionally } from '@/lib/points-checkout-service';
import { writeAuditLog } from '@/lib/audit';

/**
 * 按退款金额比例退回订单抵扣积分（个人 / 课题组原路）。
 * originalPaidYuan = 现金应付 + 积分抵扣额。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('orders.write');
  if (admin instanceof NextResponse) return admin;
  if (await isAdminMfaScenarioEnabled('finance.write')) {
    const financeAdmin = await requireAdminStepUp(admin);
    if (financeAdmin instanceof NextResponse) return financeAdmin;
  }

  const { id } = await params;
  let body: { refundYuan?: number; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 });
  }

  const refundYuan = Number(body.refundYuan);
  if (!Number.isFinite(refundYuan) || refundYuan <= 0) {
    return NextResponse.json({ error: '退款金额无效' }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      total: true,
      pointsDiscount: true,
      pointsPersonal: true,
      pointsGroup: true,
      pointsApplied: true,
      pointsRefundedPersonal: true,
      pointsRefundedGroup: true,
    },
  });
  if (!order) return NextResponse.json({ error: '订单不存在' }, { status: 404 });
  if (!order.pointsApplied || (order.pointsPersonal <= 0 && order.pointsGroup <= 0)) {
    return NextResponse.json({ error: '该订单无已扣积分可退' }, { status: 400 });
  }

  const originalPaidYuan = Math.round((order.total + order.pointsDiscount) * 100) / 100;
  const remainingPersonal = Math.max(0, order.pointsPersonal - order.pointsRefundedPersonal);
  const remainingGroup = Math.max(0, order.pointsGroup - order.pointsRefundedGroup);
  if (remainingPersonal + remainingGroup <= 0) {
    return NextResponse.json({ error: '积分已全部退回' }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const refunded = await refundOrderPointsProportionally(tx, {
      orderId: id,
      refundYuan,
      originalPaidYuan,
      actorUserId: admin.id,
      reason: body.reason?.trim() || '管理员按退款金额退回积分',
    });
    if (!refunded.ok) throw new Error(refunded.error);
    await writeAuditLog({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'order.points_refund',
      resource: 'orders',
      targetType: 'Order',
      targetId: id,
      after: {
        refundYuan,
        personal: refunded.personal,
        group: refunded.group,
      },
      reason: body.reason || null,
    }, tx);
    return refunded;
  });

  return NextResponse.json({
    ok: true,
    personal: result.personal,
    group: result.group,
    originalPaidYuan,
  });
}
