import type { Prisma } from '@prisma/client';
import { afterSalePaymentUses } from '@/lib/after-sale-payment-source';
import { normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { alipayAmountToCents } from '@/lib/alipay';
import { writeAuditLog } from '@/lib/audit';
import { reserveOrderInventory } from '@/lib/inventory';
import { jsonObject, pendingOrderRepricing } from '@/lib/order-catalog-repricing';
import { AUTO_CLOSEABLE_ORDER_STATUSES } from '@/lib/order-domain';
import { alipayCancellationRequest } from '@/lib/order-payment-review';
import { alipayReceiptWhere, settlePaymentPoints } from '@/lib/payment-concurrency';
import { POINTS_SETTLEMENT_BUSY_ERROR } from '@/lib/points-checkout-service';
import { readPurchaseActivities, type PurchaseActor } from '@/lib/purchase-activity';
import { purchaseReceiptAllocations } from '@/lib/purchase-receipts';
import { PurchaseError } from '@/lib/purchase-terms';

type Db = Prisma.TransactionClient;
export const STOCK_SHORTFALL_STATUS = 'paid_stock_shortfall_reconciliation_required';
const STOCK_SHORTFALL_AUDIT = 'payment.alipay_stock_shortfall_reconciliation_required';

export class AlipayStockReceiptDeferred extends PurchaseError {}

type AlipayOrderReceipt = {
  orderId: string; priorStatus: string; amount: number; outTradeNo: string; tradeNo: string | null;
};
type PointsStatus = 'not_required' | 'applied' | 'pending';

export async function recordAlipayOrderReceipt(
  tx: Db, receipt: AlipayOrderReceipt, pointsSettlement: PointsStatus, pointsSettlementError: string | null, actor?: PurchaseActor,
) {
  const { orderId, priorStatus, amount, outTradeNo, tradeNo } = receipt;
  await tx.order.update({ where: { id: orderId }, data: {
    ...(priorStatus === 'unpaid' ? { statusHistory: { create: {
      fromStatus: 'unpaid', toStatus: 'pending', actorEmail: actor?.email ?? 'system',
      ...(actor ? { actorId: actor.id } : {}), reason: 'alipay_paid',
    } } } : {}),
    events: { create: {
      type: 'payment_received', message: pointsSettlement === 'pending' ? '支付宝支付成功，积分待处理' : '支付宝支付成功',
      metadata: JSON.stringify({ outTradeNo, tradeNo, pointsSettlement, ...(pointsSettlementError ? { pointsSettlementError } : {}) }),
    } },
  } });
  await writeAuditLog({ actorId: actor?.id, actorEmail: actor?.email, action: 'payment.alipay_paid', resource: 'payments',
    targetType: 'Order', targetId: orderId, after: { outTradeNo, tradeNo, amount } }, tx);
}

export async function recordAlipayPointsPending(tx: Db, orderId: string, outTradeNo: string, pointsSettlementError: string | null) {
  const settlement = await tx.order.findUnique({ where: { id: orderId }, select: { pointsApplied: true } });
  await tx.order.update({ where: { id: orderId }, data: { events: { create: {
    type: 'points_settlement_pending', message: '支付宝订单积分待处理', metadata: JSON.stringify({ outTradeNo, pointsSettlementError }),
  } } } });
  await writeAuditLog({ action: 'payment.alipay_points_pending', resource: 'payments', targetType: 'Order', targetId: orderId,
    after: { outTradeNo, pointsApplied: settlement?.pointsApplied === true, reason: pointsSettlementError } }, tx);
}

export async function previewStockHeldAlipayPayment(tx: Db, orderId: string, paymentId: string) {
  const attempt = await tx.paymentAttempt.findUnique({ where: { id: paymentId }, include: { order: { select: {
    id: true, customerId: true, ownerScope: true, organizationId: true, total: true, status: true, paidAt: true, archivedAt: true,
    paymentMethod: true, pointsApplied: true, pointsPersonal: true, pointsGroup: true,
    cashPostings: { select: { id: true } }, _count: { select: { paymentAttempts: { where: alipayReceiptWhere } } },
    orderItems: { select: { id: true, productId: true, name: true, quantity: true, unitPrice: true }, orderBy: { position: 'asc' } },
  } } } });
  if (!attempt || attempt.orderId !== orderId || attempt.provider !== 'alipay' || attempt.status !== STOCK_SHORTFALL_STATUS
    || !attempt.tradeNo || !attempt.notifiedAt) throw new AlipayStockReceiptDeferred('须选择有支付宝验签收款依据的库存待核对记录');
  const { order } = attempt;
  if ((await afterSalePaymentUses(tx, orderId)).has(paymentId)) {
    throw new AlipayStockReceiptDeferred('该笔实际到账已进入具名售后退款核对，请保留原订单及交易');
  }
  if (await tx.paymentAttempt.findFirst({
    where: { ...alipayReceiptWhere, tradeNo: attempt.tradeNo, id: { not: attempt.id } }, select: { id: true },
  })) throw new AlipayStockReceiptDeferred('同一支付宝流水还有其他到账记录，请核对原交易归属');
  const amountCents = alipayAmountToCents(attempt.amount);
  if (!amountCents || amountCents !== alipayAmountToCents(order.total) || order.paidAt || order.archivedAt
    || normalizeOrderPaymentMethod(order.paymentMethod) !== 'alipay'
    || !(AUTO_CLOSEABLE_ORDER_STATUSES as readonly string[]).includes(order.status)
    || !order.orderItems.length || order.cashPostings.length || order._count.paymentAttempts !== 1 || await pendingOrderRepricing(tx, orderId)) {
    throw new AlipayStockReceiptDeferred('原订单金额、付款状态或其他到账依据有变化，请保留该差异待办');
  }
  const allocations = await purchaseReceiptAllocations(tx, order, await readPurchaseActivities(tx, orderId));
  if (allocations.allocatedCents || allocations.excludedReceiptIds.length) {
    throw new AlipayStockReceiptDeferred('本单还有其他到账依据，请先核对交易归属');
  }
  const audits = await tx.auditLog.findMany({ where: { action: STOCK_SHORTFALL_AUDIT, resource: 'payments', targetType: 'Order', targetId: orderId } });
  const receivedAt = attempt.notifiedAt.toISOString();
  const providerPaidAt = attempt.paidAt?.toISOString() ?? null;
  const proofs = audits.filter(row => {
    const data = jsonObject(row.afterData);
    return data.outTradeNo === attempt.outTradeNo && data.tradeNo === attempt.tradeNo && data.reason === 'insufficient_available_inventory'
      && typeof data.amount === 'number' && alipayAmountToCents(data.amount) === amountCents
      && (!Object.hasOwn(data, 'providerPaidAt') || data.providerPaidAt === providerPaidAt)
      && (!Object.hasOwn(data, 'firstNotifiedAt') || data.firstNotifiedAt === receivedAt);
  });
  if (proofs.length !== 1) throw new AlipayStockReceiptDeferred('缺少可唯一确认的支付宝验签原记录');
  const cancellationRequest = await alipayCancellationRequest(tx, orderId, attempt.id);
  return { id: attempt.id, auditId: proofs[0].id, orderId, priorStatus: order.status, amount: attempt.amount, orderTotal: order.total, amountCents,
    outTradeNo: attempt.outTradeNo, tradeNo: attempt.tradeNo, providerPaidAt, receivedAt, cancellationRequest,
    lines: order.orderItems, points: { applied: order.pointsApplied, personal: order.pointsPersonal, group: order.pointsGroup } };
}

export async function applyStockHeldAlipayPayment(tx: Db, op: Awaited<ReturnType<typeof previewStockHeldAlipayPayment>>, actor?: PurchaseActor) {
  if (op.cancellationRequest && !actor) throw new AlipayStockReceiptDeferred('订单已有人提出取消或移除，请先由财务核对该意愿和原到账');
  try {
    await reserveOrderInventory(tx, op.orderId, actor?.id ?? null, '支付宝原回执核对后预占库存');
  } catch (error) {
    if (error instanceof Error && error.message === 'INSUFFICIENT_AVAILABLE_INVENTORY') throw new AlipayStockReceiptDeferred('本单可售库存仍不足，保留原到账待办');
    throw error;
  }
  const paidAt = new Date(op.providerPaidAt ?? op.receivedAt);
  const order = await tx.order.updateMany({ where: { id: op.orderId, status: op.priorStatus, total: op.orderTotal, paidAt: null, archivedAt: null },
    data: { paidAt, status: 'pending', autoCloseAt: null } });
  const attempt = await tx.paymentAttempt.updateMany({ where: { id: op.id, orderId: op.orderId, tradeNo: op.tradeNo, status: STOCK_SHORTFALL_STATUS },
    data: { status: 'paid', paidAt } });
  if (order.count !== 1 || attempt.count !== 1) throw new AlipayStockReceiptDeferred('订单或原交易已变化，请重新核对');
  let pointsSettlement: PointsStatus = 'not_required';
  let pointsError: string | null = null;
  if (!op.points.applied && (op.points.personal > 0 || op.points.group > 0)) {
    const points = await settlePaymentPoints(tx, op.orderId);
    if (points.ok) pointsSettlement = 'applied';
    else if (points.error !== POINTS_SETTLEMENT_BUSY_ERROR) {
      pointsSettlement = 'pending';
      pointsError = points.error;
    }
  }
  await recordAlipayOrderReceipt(tx, op, pointsSettlement, pointsError, actor);
  if (pointsSettlement === 'pending') await recordAlipayPointsPending(tx, op.orderId, op.outTradeNo, pointsError);
}
