import type { Prisma } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit';
import { releaseOrderReceivableOnCancellation } from '@/lib/customer-credit';
import { releaseOrderInventory } from '@/lib/inventory';
import { canTransitionOrder, isInactiveOrderStatus, isOrderStatus, requiresPaidAlipayRefund } from '@/lib/order-domain';
import { refundOrderPointsProportionally } from '@/lib/points-checkout-service';

type Tx = Prisma.TransactionClient;

export class AdminOrderWithdrawalError extends Error {
  readonly code: string;
  readonly status: number;
  readonly orderId?: string;

  constructor(code: string, status: number, orderId?: string) {
    super(code);
    this.name = 'AdminOrderWithdrawalError';
    this.code = code;
    this.status = status;
    this.orderId = orderId;
  }
}

type WithdrawalOrder = {
  id: string;
  status: string;
  paymentMethod: string | null;
  paidAt: Date | null;
  total: number;
  pointsDiscount: number;
  pointsPersonal: number;
  pointsGroup: number;
  pointsRefundedPersonal: number;
  pointsRefundedGroup: number;
  archivedAt: Date | null;
};

/**
 * 后台「删除订单」不再物理删除。
 * 能取消的订单先释放预占库存、未结授信和已扣积分，再写入已取消并归档。
 * 已取消或已关闭的订单只补做幂等释放并归档。
 * 已发货、已完成，或已付款仍需退款的订单整批拒绝，避免抹掉履约和付款记录。
 */
export async function withdrawAdminOrders(
  tx: Tx,
  orderIds: string[],
  actor: { id: string; email: string },
  now = new Date(),
): Promise<number> {
  const uniqueIds = [...new Set(orderIds.map((id) => (typeof id === 'string' ? id.trim() : '')).filter(Boolean))];
  if (uniqueIds.length === 0) throw new AdminOrderWithdrawalError('ORDER_NOT_FOUND', 404);

  const orders = await tx.order.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      status: true,
      paymentMethod: true,
      paidAt: true,
      total: true,
      pointsDiscount: true,
      pointsPersonal: true,
      pointsGroup: true,
      pointsRefundedPersonal: true,
      pointsRefundedGroup: true,
      archivedAt: true,
    },
  });
  if (orders.length !== uniqueIds.length) throw new AdminOrderWithdrawalError('ORDER_NOT_FOUND', 404);

  const byId = new Map(orders.map((order) => [order.id, order]));
  for (const id of uniqueIds) {
    await withdrawOne(tx, byId.get(id)!, actor, now);
  }
  return uniqueIds.length;
}

async function withdrawOne(
  tx: Tx,
  order: WithdrawalOrder,
  actor: { id: string; email: string },
  now: Date,
) {
  const alreadyInactive = isInactiveOrderStatus(order.status);
  if (!alreadyInactive) {
    if (requiresPaidAlipayRefund('cancelled', order.paymentMethod, order.paidAt)) {
      throw new AdminOrderWithdrawalError('PAID_ORDER_REFUND_REQUIRED', 409, order.id);
    }
    if (!isOrderStatus(order.status) || !canTransitionOrder(order.status, 'cancelled')) {
      throw new AdminOrderWithdrawalError('ORDER_DELETE_BLOCKED', 409, order.id);
    }
  }

  const nextStatus = alreadyInactive ? order.status : 'cancelled';
  await tx.order.update({
    where: { id: order.id },
    data: {
      archivedAt: now,
      autoCloseAt: null,
      ...(alreadyInactive ? {} : {
        status: 'cancelled',
        statusHistory: {
          create: {
            fromStatus: order.status,
            toStatus: 'cancelled',
            actorId: actor.id,
            actorEmail: actor.email,
            reason: 'admin_withdraw',
          },
        },
        events: {
          create: {
            type: 'status_changed',
            actorId: actor.id,
            actorEmail: actor.email,
            message: `${order.status} -> cancelled`,
            metadata: JSON.stringify({
              fromStatus: order.status,
              toStatus: 'cancelled',
              reason: 'admin_withdraw',
              archived: true,
            }),
          },
        },
      }),
    },
  });

  // 只要还有未结应收就回退已用额度。没有应收，或应收已经是取消状态时，该调用直接返回。
  try {
    await releaseOrderReceivableOnCancellation(tx, order.id, actor.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'PAID_ORDER_REFUND_REQUIRED' || message === 'CREDIT_ACCOUNT_NOT_FOUND') {
      throw new AdminOrderWithdrawalError(message, 409, order.id);
    }
    throw err;
  }
  await releaseOrderInventory(tx, order.id, actor.id, '管理员移除订单释放库存');

  const originalPaidYuan = Math.round((order.total + order.pointsDiscount) * 100) / 100;
  const refunded = await refundOrderPointsProportionally(tx, {
    orderId: order.id,
    refundYuan: originalPaidYuan,
    originalPaidYuan,
    actorUserId: actor.id,
    reason: '管理员移除订单退回积分',
  });
  const remainingPersonal = Math.max(0, order.pointsPersonal - order.pointsRefundedPersonal);
  const remainingGroup = Math.max(0, order.pointsGroup - order.pointsRefundedGroup);
  if (!refunded.ok && (remainingPersonal > 0 || remainingGroup > 0)) {
    throw new AdminOrderWithdrawalError('POINTS_REFUND_FAILED', 409, order.id);
  }

  await writeAuditLog({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'order.withdrawn',
    resource: 'orders',
    targetType: 'Order',
    targetId: order.id,
    before: { status: order.status, archivedAt: order.archivedAt },
    after: { status: nextStatus, archivedAt: now.toISOString() },
    reason: 'admin_withdraw',
  }, tx);
}
