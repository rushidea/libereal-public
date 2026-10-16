import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { calculateCumulativePointsRefund } from '@/lib/points-checkout';
import { POINTS_REFUND_FAILED, refundOrderPointsProportionally, requirePointsRefund } from '@/lib/points-checkout-service';
import { writeAuditLog } from '@/lib/audit';

/**
 * 按累计已退现金占原应付的比例退回订单抵扣积分（个人 / 课题组原路）。
 * originalPaidYuan = 现金应付 + 积分抵扣额。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('finance.write');
  if (admin instanceof NextResponse) return admin;

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
      pointsRefundedCash: true,
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

  const plan = calculateCumulativePointsRefund({
    originalPersonal: order.pointsPersonal,
    originalGroup: order.pointsGroup,
    refundedPersonal: order.pointsRefundedPersonal,
    refundedGroup: order.pointsRefundedGroup,
    refundedCashYuan: order.pointsRefundedCash,
    refundYuan,
    originalPaidYuan,
  });
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const refunded = requirePointsRefund(await refundOrderPointsProportionally(tx, {
        orderId: id,
        refundYuan,
        originalPaidYuan,
        actorUserId: admin.id,
        reason: body.reason?.trim() || '管理员按退款金额退回积分',
      }));
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
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === POINTS_REFUND_FAILED) {
      const detail = err instanceof Error && typeof err.cause === 'string' ? err.cause : '积分未能退回，请稍后重试';
      return NextResponse.json({ error: detail }, { status: 409 });
    }
    console.error('[admin/orders/points-refund POST] error:', err);
    return NextResponse.json({ error: '积分退回失败' }, { status: 500 });
  }
}
