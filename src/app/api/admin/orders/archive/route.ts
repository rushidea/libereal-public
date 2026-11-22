import { NextRequest, NextResponse } from 'next/server';
import { AdminOrderWithdrawalError, withdrawAdminOrders } from '@/lib/admin-order-withdrawal';
import { isAdminMfaScenarioEnabled } from '@/lib/admin-mfa-settings';
import { prisma } from '@/lib/prisma';
import { authorizeAdminOrderMutation, consumeAdminOrderStepUp, extractStepUpToken } from '@/lib/admin-order-step-up';
import { requireAdminStepUp } from '@/lib/session';
import { orderAutoCloseAt } from '@/lib/order-auto-close';
import { AUTO_CLOSEABLE_ORDER_STATUSES } from '@/lib/order-domain';

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null) as { orderIds?: unknown; action?: unknown; stepUpToken?: unknown } | null;
  const stepUpToken = extractStepUpToken(body);
  const session = await authorizeAdminOrderMutation('orders.write', stepUpToken);
  if (session instanceof NextResponse) return session;

  try {
    const orderIds = Array.isArray(body?.orderIds)
      ? body.orderIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
    const action = typeof body?.action === 'string' ? body.action : '';

    if (orderIds.length === 0) {
      return NextResponse.json({ error: "缺少orderIds" }, { status: 400 });
    }

    const now = new Date();

    if (action === 'archive') {
      const stepUpFailure = await consumeAdminOrderStepUp(session, stepUpToken);
      if (stepUpFailure) return stepUpFailure;
      await prisma.order.updateMany({
        where: { id: { in: orderIds } },
        data: { archivedAt: now, autoCloseAt: null }, // 归档即退出自动关闭
      });
    } else if (action === 'unarchive') {
      const stepUpFailure = await consumeAdminOrderStepUp(session, stepUpToken);
      if (stepUpFailure) return stepUpFailure;
      // 反归档：订单若仍处于未付款或待确认，重武装 autoCloseAt
      await prisma.order.updateMany({
        where: { id: { in: orderIds } },
        data: { archivedAt: null },
      });
      const reopenable = await prisma.order.findMany({
        where: { id: { in: orderIds }, status: { in: [...AUTO_CLOSEABLE_ORDER_STATUSES] } },
        select: { id: true, paymentMethod: true },
      });
      if (reopenable.length > 0) {
        await prisma.$transaction(reopenable.map((order) => prisma.order.update({
          where: { id: order.id },
          data: { autoCloseAt: orderAutoCloseAt(order.paymentMethod) },
        })));
      }
    } else if (action === 'delete') {
      // 物理删除会级联掉预占和应收，但不会回退库存占用、授信和已扣积分。
      // 改为取消并归档：能取消的订单先释放这三项，财务和履约记录保留。
      if (!stepUpToken && await isAdminMfaScenarioEnabled('finance.write')) {
        const financeAdmin = await requireAdminStepUp(session);
        if (financeAdmin instanceof NextResponse) return financeAdmin;
      }
      const stepUpFailure = await consumeAdminOrderStepUp(session, stepUpToken);
      if (stepUpFailure) return stepUpFailure;
      const count = await prisma.$transaction((tx) => withdrawAdminOrders(tx, orderIds, {
        id: session.id,
        email: session.email,
      }));
      return NextResponse.json({ success: true, count });
    } else {
      return NextResponse.json({ error: "无效操作" }, { status: 400 });
    }

    return NextResponse.json({ success: true, count: orderIds.length });
  } catch (err) {
    if (err instanceof AdminOrderWithdrawalError) {
      return NextResponse.json(
        { error: err.code, ...(err.orderId ? { orderId: err.orderId } : {}) },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : '';
    if (message === 'PAID_ORDER_REFUND_REQUIRED' || message === 'CREDIT_ACCOUNT_NOT_FOUND') {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    console.error("[admin/orders/archive PATCH]", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
