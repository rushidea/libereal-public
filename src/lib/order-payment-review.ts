import type { Prisma } from '@prisma/client';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { alipayReceiptWhere } from '@/lib/payment-concurrency';

const cancellationType = 'alipay_cancellation_requested';
type RequestedAction = 'cancelled' | 'closed' | 'removed' | 'archived';

export const alipayCancellationPending = {
  error: 'ALIPAY_RECEIPT_PENDING_REVIEW', requestRecorded: true,
} as const;

export async function recordOrderChangeDuringAlipayReview(
  tx: Prisma.TransactionClient, orderId: string, actor: { id: string; email: string }, requestedAction: RequestedAction, reason?: unknown,
) {
  const payments = await tx.paymentAttempt.findMany({
    where: { orderId, ...alipayReceiptWhere }, select: { id: true, status: true, order: { select: { paidAt: true } } }, orderBy: { id: 'asc' },
  });
  if (!payments.length || payments.every(payment => payment.status === 'paid' && payment.order.paidAt)) return false;
  const metadata = JSON.stringify({ requestedAction, reason: typeof reason === 'string' ? reason.trim().slice(0, 2000) : null,
    paymentIds: payments.map(payment => payment.id) });
  const existing = await tx.orderEvent.findFirst({ where: { orderId, type: cancellationType, actorId: actor.id, metadata }, select: { id: true } });
  if (!existing) await tx.orderEvent.create({ data: { orderId, type: cancellationType, actorId: actor.id, actorEmail: actor.email,
    message: '订单处理意愿已记录，原支付宝到账待财务核对', metadata } });
  return true;
}

export async function alipayCancellationRequest(tx: Prisma.TransactionClient, orderId: string, paymentId: string | null = null) {
  const records = await tx.orderEvent.findMany({ where: { orderId, type: cancellationType },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, actorId: true, metadata: true, createdAt: true } });
  for (const row of records) {
    const data = jsonObject(row.metadata);
    if (!Array.isArray(data.paymentIds) || paymentId && !data.paymentIds.includes(paymentId)) continue;
    return { id: row.id, actorId: row.actorId, requestedAction: data.requestedAction, reason: data.reason, recordedAt: row.createdAt.toISOString() };
  }
  return null;
}
