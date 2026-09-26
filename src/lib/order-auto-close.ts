// 自动关闭超时未付款或未确认的订单（由独立定时任务 /api/cron/auto-close 触发）
//
// 规则：status 为 unpaid 或 pending，且 autoCloseAt（= createdAt + 48h）已到期的订单自动关闭（置 closed）。
// 事务动作与管理员手动取消一致：释放应收款/库存、退回积分、写状态历史 + 事件 + 审计。
// 已付款的支付宝订单排除，需走退款流程。
// 用 autoCloseAt 走索引查询，处理成本与到期数量相关。
// 订单离开 unpaid/pending（付款进入待确认、确认、取消、关闭、归档）时 autoCloseAt 被置 null。

import { prisma } from '@/lib/prisma';
import { releaseOrderReceivableOnCancellation } from '@/lib/customer-credit';
import { releaseOrderInventory } from '@/lib/inventory';
import { refundOrderPointsProportionally } from '@/lib/points-checkout-service';
import { isAlipayPaymentMethod, isPostDeliveryPaymentMethod } from '@/data/payment-methods';
import { ALIPAY_PAYMENT_WINDOW_MS } from '@/data/alipay-payment';
import { writeAuditLog } from '@/lib/audit';
import { applyOrderPointsDeduction } from '@/lib/points-checkout-service';
import { AUTO_CLOSEABLE_ORDER_STATUSES, assertOrderTransition, INACTIVE_ORDER_STATUSES, isAutoCloseableOrderStatus } from '@/lib/order-domain';

export const AUTO_CLOSE_HOURS = 48;

export function orderAutoCloseAt(paymentMethod: unknown, from = new Date()): Date {
  const durationMs = isAlipayPaymentMethod(paymentMethod)
    ? ALIPAY_PAYMENT_WINDOW_MS
    : AUTO_CLOSE_HOURS * 60 * 60 * 1000;
  return new Date(from.getTime() + durationMs);
}

const ALIPAY_PAYMENT_METHOD_STORAGE_VALUES = ['alipay', 'zfb', '支付宝', '支付宝扫码'];

/**
 * 补偿结算部署前创建、支付宝已收款但积分尚未结算的历史订单。
 * 新订单在下单事务内已经占用积分，此扫描主要覆盖迁移窗口中的旧订单。
 */
export async function reconcilePendingAlipayOrderPoints(batchLimit = 100): Promise<{ reconciled: number; failed: number }> {
  const orders = await prisma.order.findMany({
    where: {
      paymentMethod: { in: ALIPAY_PAYMENT_METHOD_STORAGE_VALUES },
      paidAt: { not: null },
      pointsApplied: false,
      status: { notIn: [...INACTIVE_ORDER_STATUSES] },
      OR: [{ pointsPersonal: { gt: 0 } }, { pointsGroup: { gt: 0 } }],
    },
    select: { id: true },
    orderBy: { paidAt: 'asc' },
    take: batchLimit,
  });

  let reconciled = 0;
  let failed = 0;
  for (const order of orders) {
    try {
      const applied = await prisma.$transaction(async (tx) => {
        const result = await applyOrderPointsDeduction(tx, order.id);
        if (!result.ok) return false;
        await tx.order.update({
          where: { id: order.id },
          data: {
            events: {
              create: {
                type: 'points_settlement_reconciled',
                message: '支付宝订单积分已补偿结算',
                metadata: JSON.stringify({ source: 'auto_reconcile' }),
              },
            },
          },
        });
        await writeAuditLog({
          actorId: null,
          actorEmail: 'system',
          action: 'payment.alipay_points_reconciled',
          resource: 'payments',
          targetType: 'Order',
          targetId: order.id,
          after: { pointsApplied: true, source: 'auto_reconcile' },
        }, tx);
        return true;
      });
      if (applied) reconciled += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      console.error('[order-auto-close] reconcile points failed:', order.id, error instanceof Error ? error.message : error);
    }
  }

  return { reconciled, failed };
}

export async function closeStalePendingOrders(now = new Date(), batchLimit = 100): Promise<{ closed: number; skipped: number }> {
  const staleOrders = await prisma.order.findMany({
    where: {
      status: { in: [...AUTO_CLOSEABLE_ORDER_STATUSES] },
      archivedAt: null,
      autoCloseAt: { lt: now },
      NOT: { paymentMethod: { in: ALIPAY_PAYMENT_METHOD_STORAGE_VALUES }, paidAt: { not: null } },
    },
    select: { id: true, status: true, paymentMethod: true, paidAt: true, total: true, pointsDiscount: true },
    orderBy: { autoCloseAt: 'asc' },
    take: batchLimit,
  });

  let closed = 0;
  let failed = 0;

  for (const order of staleOrders) {
    if (isAlipayPaymentMethod(order.paymentMethod) && order.paidAt) {
      failed += 1;
      continue;
    }
    try {
      const didClose = await prisma.$transaction(async (tx) => {
        const fresh = await tx.order.findUnique({ where: { id: order.id }, select: { status: true } });
        if (!fresh || !isAutoCloseableOrderStatus(fresh.status)) return false;
        assertOrderTransition(fresh.status, 'closed');

        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'closed',
            autoCloseAt: null,
            statusHistory: {
              create: {
                fromStatus: fresh.status,
                toStatus: 'closed',
                actorId: null,
                actorEmail: 'system',
                reason: 'auto_close_timeout',
              },
            },
            events: {
              create: {
                type: 'status_changed',
                actorId: null,
                actorEmail: 'system',
                message: `${fresh.status} -> closed`,
                metadata: JSON.stringify({ fromStatus: fresh.status, toStatus: 'closed', reason: 'auto_close_timeout', auto: true }),
              },
            },
          },
        });

        if (isPostDeliveryPaymentMethod(order.paymentMethod)) await releaseOrderReceivableOnCancellation(tx, order.id, null);
        await releaseOrderInventory(tx, order.id, null, '超时未付款自动关闭释放库存');
        const originalPaidYuan = Math.round((order.total + order.pointsDiscount) * 100) / 100;
        await refundOrderPointsProportionally(tx, {
          orderId: order.id,
          refundYuan: originalPaidYuan,
          originalPaidYuan,
          actorUserId: null,
          reason: '超时未付款自动关闭退回积分',
        });
        await writeAuditLog(
          { actorId: null, actorEmail: 'system', action: 'order.auto_closed', resource: 'orders', targetType: 'Order', targetId: order.id, before: { status: fresh.status }, after: { status: 'closed' }, reason: 'auto_close_timeout' },
          tx,
        );
        return true;
      });
      if (didClose) closed += 1;
    } catch (err) {
      failed += 1;
      console.error('[order-auto-close] close order failed:', order.id, err instanceof Error ? err.message : err);
    }
  }

  return { closed, skipped: failed };
}
