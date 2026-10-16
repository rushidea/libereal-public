// 自动关闭超时未付款或未确认的订单（由独立定时任务 /api/cron/auto-close 触发）
//
// 规则：status 为 unpaid 或 pending，且 autoCloseAt（= createdAt + 48h）已到期的订单自动关闭（置 closed）。
// 事务动作与管理员手动取消一致：释放应收款/库存、退回积分、写状态历史 + 事件 + 审计。
// 已付款的支付宝订单排除，需走退款流程。
// 用 autoCloseAt 走索引查询，处理成本与到期数量相关。
// 订单离开 unpaid/pending（付款进入待确认、确认、取消、关闭、归档）时 autoCloseAt 被置 null。

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { releaseOrderReceivableOnCancellation } from '@/lib/customer-credit';
import { releaseOrderInventory } from '@/lib/inventory';
import {
  applyOrderPointsDeduction,
  POINTS_DEDUCTION_ROLLBACK_REASON,
  POINTS_SETTLEMENT_BUSY_ERROR,
  refundOrderPointsProportionally,
  requirePointsRefund,
} from '@/lib/points-checkout-service';
import { isAlipayPaymentMethod, isPostDeliveryPaymentMethod } from '@/data/payment-methods';
import { ALIPAY_PAYMENT_WINDOW_MS } from '@/data/alipay-payment';
import { writeAuditLog } from '@/lib/audit';
import { AUTO_CLOSEABLE_ORDER_STATUSES, assertOrderTransition, INACTIVE_ORDER_STATUSES, isAutoCloseableOrderStatus } from '@/lib/order-domain';

export const AUTO_CLOSE_HOURS = 48;

export function orderAutoCloseAt(paymentMethod: unknown, from = new Date()): Date {
  const durationMs = isAlipayPaymentMethod(paymentMethod)
    ? ALIPAY_PAYMENT_WINDOW_MS
    : AUTO_CLOSE_HOURS * 60 * 60 * 1000;
  return new Date(from.getTime() + durationMs);
}

const ALIPAY_PAYMENT_METHOD_STORAGE_VALUES = ['alipay', 'zfb', '支付宝', '支付宝扫码'];

type PointsAuditClient = Prisma.TransactionClient | typeof prisma;

/**
 * 支付宝已收款、但积分占用和负向流水不一致的订单。
 * 包含尚未占用的订单，以及占用标记已写上、流水却没有扣满的订单。
 * 失败回滚流水不计入已扣减，避免补偿任务把这种订单永久跳过。
 */
async function findAlipayOrdersNeedingPointsSettlement(batchLimit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT o.id
    FROM "Order" o
    WHERE o.paymentMethod IN (${Prisma.join(ALIPAY_PAYMENT_METHOD_STORAGE_VALUES)})
      AND o.paidAt IS NOT NULL
      AND o.status NOT IN (${Prisma.join([...INACTIVE_ORDER_STATUSES])})
      AND (o.pointsPersonal > 0 OR o.pointsGroup > 0)
      AND (
        o.pointsApplied = 0
        OR (
          o.pointsApplied = 1
          AND (
            (
              o.pointsPersonal > 0
              AND COALESCE((
                SELECT SUM(p.delta)
                FROM "PointsLog" p
                WHERE p.relatedId = o.id
                  AND p.userId = o.customerId
                  AND (
                    p.type = 'order_redeem'
                    OR (p.type = 'order_redeem_refund' AND p.reason = ${POINTS_DEDUCTION_ROLLBACK_REASON})
                  )
              ), 0) > -o.pointsPersonal
            )
            OR (
              o.pointsGroup > 0
              AND COALESCE((
                SELECT SUM(g.delta)
                FROM "GroupPointsLog" g
                WHERE g.relatedId = o.id
                  AND g.groupId = o.pointsGroupId
                  AND (
                    g.type = 'order_redeem'
                    OR (g.type = 'order_redeem_refund' AND g.reason = ${POINTS_DEDUCTION_ROLLBACK_REASON})
                  )
              ), 0) > -o.pointsGroup
            )
          )
        )
      )
    ORDER BY o.paidAt ASC
    LIMIT ${batchLimit}
  `);
  return rows.map((row) => row.id);
}

async function recordUnsettledPointsFailure(client: PointsAuditClient, orderId: string, error: string) {
  const existing = await client.orderEvent.findFirst({
    where: { orderId, type: 'points_settlement_pending' },
    orderBy: { createdAt: 'desc' },
    select: { metadata: true },
  });
  if (existing?.metadata) {
    try {
      const parsed = JSON.parse(existing.metadata) as { pointsSettlementError?: string };
      if (parsed.pointsSettlementError === error) return;
    } catch {
      // 旧记录无法解析时补一条新的失败事实。
    }
  }

  await client.orderEvent.create({
    data: {
      orderId,
      type: 'points_settlement_pending',
      message: '支付宝订单积分待处理',
      metadata: JSON.stringify({ source: 'auto_reconcile', pointsSettlementError: error }),
    },
  });
  await writeAuditLog({
    actorId: null,
    actorEmail: 'system',
    action: 'payment.alipay_points_reconcile_failed',
    resource: 'payments',
    targetType: 'Order',
    targetId: orderId,
    after: { settled: false, reason: error, source: 'auto_reconcile' },
  }, client);
}

/**
 * 补偿支付宝已收款但积分尚未扣满的订单。
 * 新订单在下单事务内占用积分；这里覆盖到账时扣减失败，以及占用标记和流水不一致的订单。
 */
export async function reconcilePendingAlipayOrderPoints(batchLimit = 100): Promise<{ reconciled: number; failed: number }> {
  const orderIds = await findAlipayOrdersNeedingPointsSettlement(batchLimit);

  let reconciled = 0;
  let failed = 0;
  for (const orderId of orderIds) {
    try {
      const applied = await prisma.$transaction(async (tx) => {
        const result = await applyOrderPointsDeduction(tx, orderId);
        if (!result.ok) {
          if (result.error !== POINTS_SETTLEMENT_BUSY_ERROR) {
            await recordUnsettledPointsFailure(tx, orderId, result.error);
          }
          return false;
        }
        await tx.order.update({
          where: { id: orderId },
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
          targetId: orderId,
          after: { pointsApplied: true, source: 'auto_reconcile' },
        }, tx);
        return true;
      });
      if (applied) reconciled += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : '积分结算失败';
      console.error('[order-auto-close] reconcile points failed:', orderId, message);
      try {
        await recordUnsettledPointsFailure(prisma, orderId, message);
      } catch (recordError) {
        console.error('[order-auto-close] record points failure failed:', orderId, recordError instanceof Error ? recordError.message : recordError);
      }
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
        requirePointsRefund(await refundOrderPointsProportionally(tx, {
          orderId: order.id,
          refundYuan: originalPaidYuan,
          originalPaidYuan,
          actorUserId: null,
          reason: '超时未付款自动关闭退回积分',
        }));
        await writeAuditLog(
          { actorId: null, actorEmail: 'system', action: 'order.auto_closed', resource: 'orders', targetType: 'Order', targetId: order.id, before: { status: fresh.status }, after: { status: 'closed' }, reason: 'auto_close_timeout' },
          tx,
        );
        return true;
      });
      if (didClose) closed += 1;
    } catch (err) {
      failed += 1;
      const detail = err instanceof Error
        ? `${err.message}${typeof err.cause === 'string' ? `: ${err.cause}` : ''}`
        : err;
      console.error('[order-auto-close] close order failed:', order.id, detail);
    }
  }

  return { closed, skipped: failed };
}
