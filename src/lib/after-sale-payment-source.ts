import { alipayAmountToCents } from '@/lib/alipay';
import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { isAlipayReconciliationStatus, alipayReceiptWhere } from '@/lib/payment-concurrency';
import { purchaseObject } from '@/lib/purchase-activity';
import { condition } from '@/lib/after-sale-records';

const auditReasons: Record<string, { action: string; reason?: string }> = {
  paid: { action: 'payment.alipay_paid' },
  rejected_order_cancelled: { action: 'payment.alipay_rejected', reason: 'rejected_order_cancelled' },
  rejected_amount_mismatch: { action: 'payment.alipay_rejected', reason: 'rejected_amount_mismatch' },
  paid_stock_shortfall_reconciliation_required: { action: 'payment.alipay_stock_shortfall_reconciliation_required', reason: 'insufficient_available_inventory' },
  paid_superseded_reconciliation_required: { action: 'payment.alipay_superseded_paid_reconciliation_required', reason: 'superseded_attempt_paid' },
  paid_terminal_reconciliation_required: { action: 'payment.alipay_terminal_paid_reconciliation_required', reason: 'closed_attempt_paid' },
};

export async function verifiedAfterSalePayment(tx: Db, orderId: string, paymentId: string) {
  const attempt = await tx.paymentAttempt.findFirst({ where: { id: paymentId, orderId, provider: 'alipay' },
    include: { order: { select: { customerId: true, organizationId: true, ownerScope: true, email: true } } } });
  condition(attempt && attempt.tradeNo && attempt.notifiedAt && auditReasons[attempt.status], '原平台交易缺少可核实的验签到账记录');
  const amountCents = alipayAmountToCents(attempt.amount);
  condition(amountCents && !(await tx.paymentAttempt.findFirst({
    where: { ...alipayReceiptWhere, id: { not: attempt.id }, tradeNo: attempt.tradeNo }, select: { id: true },
  })), '原交易金额或到账归属存在冲突');
  const expected = auditReasons[attempt.status];
  const audits = await tx.auditLog.findMany({ where: { action: expected.action, resource: 'payments', targetType: 'Order', targetId: orderId }, orderBy: { id: 'asc' } });
  const verified = audits.filter(row => {
    const op = jsonObject(row.afterData);
    return op.outTradeNo === attempt.outTradeNo && op.tradeNo === attempt.tradeNo
      && typeof op.amount === 'number' && alipayAmountToCents(op.amount) === amountCents
      && (!expected.reason || op.reason === expected.reason);
  });
  condition(verified.length === 1, '请选择能由唯一验签记录确认的实际原交易');
  return { paymentId: attempt.id, status: attempt.status, orderId, tradeNo: attempt.tradeNo, outTradeNo: attempt.outTradeNo, amountCents,
    arrivedAt: (attempt.paidAt ?? attempt.notifiedAt).toISOString(), auditId: verified[0].id, customer: attempt.order };
}

export function eligibleAfterSalePayment(source: Awaited<ReturnType<typeof verifiedAfterSalePayment>>,
  order: { acceptance: unknown; status: string },
  finance: { nativePaymentId: string | null; cash: { paymentAttemptId: string | null }[] }) {
  if (!order.acceptance || ['cancelled','closed'].includes(order.status)) return true;
  return isAlipayReconciliationStatus(source.status) && (source.status !== 'paid_stock_shortfall_reconciliation_required' || finance.nativePaymentId !== null)
    && source.paymentId !== finance.nativePaymentId && !finance.cash.some(row => row.paymentAttemptId === source.paymentId);
}

export async function afterSalePaymentUses(tx: Db, orderId: string) {
  const events = await tx.afterSaleEvent.findMany({ where: {
    action: { in: ['review_refund_source', 'release_refund_source', 'refund_result', 'agreement'] }, case: { orderId },
  }, select: { id: true, caseId: true, actorId: true, action: true, detail: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const byPayment = new Map<string, { caseIds: string[]; ownerId: string; reviewId: string; paidCents: number; receivedCents: number }>();
  for (const event of events) {
    if (event.action !== 'review_refund_source') continue;
    const op = purchaseObject(jsonObject(event.detail).operation);
    const source = purchaseObject(op.originalPayment);
    if (typeof source.paymentId !== 'string' || typeof source.amountCents !== 'number') continue;
    const outcomes = events.filter(row => row.caseId === event.caseId && row.action !== 'review_refund_source')
      .map(row => ({ action: row.action, op:purchaseObject(jsonObject(row.detail).operation) }));
    const paid = outcomes.reduce((sum, {action,op:result}) => action === 'refund_result' && result.result === 'paid' && result.sourcePaymentId === source.paymentId
      && typeof result.amountCents === 'number' ? sum + result.amountCents : sum, 0);
    const agreement=outcomes.filter(row=>row.action==='agreement'&&!row.op.historical).at(-1);
    const released = outcomes.some(({action, op}) => action === 'release_refund_source' && op.reviewId === event.id);
    if (released || !paid && agreement?.op.remedy === 'refund_withdraw') continue;
    const current = byPayment.get(source.paymentId);
    if (!current) byPayment.set(source.paymentId, { caseIds: [event.caseId], ownerId: event.actorId, reviewId: event.id,
      paidCents: paid, receivedCents: source.amountCents });
    else if (!current.caseIds.includes(event.caseId)) {
      current.caseIds.push(event.caseId);
      current.paidCents += paid;
    }
  }
  return byPayment;
}
