import type { Prisma } from '@prisma/client';
import { isPostDeliveryPaymentMethod } from '@/data/payment-methods';
import { writeAuditLog } from '@/lib/audit';
import { isUnsettledReceivableStatus, syncUnsettledReceivableAmount } from '@/lib/customer-credit';
import { calculateOrderAmounts } from '@/lib/order-domain';

type Tx = Prisma.TransactionClient;

const AMOUNT_LOCKED_STATUSES = new Set([
  'completed',
  'cancelled',
  'closed',
  'shipped',
  'partially_shipped',
]);

export type OrderAmountChange =
  | { op: 'create'; type: string; label: string; amount: number; reason: string | null }
  | { op: 'delete'; adjustmentId: string };

export type OrderAmountAdjustmentResult = {
  adjustmentId: string | null;
  adjustment: {
    id: string;
    orderId: string;
    type: string;
    label: string;
    amount: number;
    reason: string | null;
    createdBy: string | null;
  } | null;
  total: number;
};

export async function applyOrderAmountAdjustment(
  tx: Tx,
  input: {
    orderId: string;
    actor: { id: string; email: string };
    change: OrderAmountChange;
  },
): Promise<OrderAmountAdjustmentResult> {
  const order = await tx.order.findUnique({
    where: { id: input.orderId },
    include: { orderItems: true, adjustments: true, receivable: true },
  });
  if (!order) throw new Error('ORDER_NOT_FOUND');
  if (AMOUNT_LOCKED_STATUSES.has(order.status)) throw new Error('ORDER_AMOUNT_LOCKED');
  if (order.receivable && !isUnsettledReceivableStatus(order.receivable.status)) {
    throw new Error('ORDER_AMOUNT_LOCKED');
  }
  if (
    !order.receivable
    && order.status === 'confirmed'
    && isPostDeliveryPaymentMethod(order.paymentMethod)
  ) {
    throw new Error('RECEIVABLE_NOT_FOUND');
  }

  const deleteId = input.change.op === 'delete' ? input.change.adjustmentId : null;
  const removed = deleteId
    ? order.adjustments.find((item) => item.id === deleteId) ?? null
    : null;
  if (deleteId && !removed) throw new Error('ADJUSTMENT_NOT_FOUND');

  const nextAdjustments = removed
    ? order.adjustments.filter((item) => item.id !== removed.id)
    : [...order.adjustments, { amount: input.change.op === 'create' ? input.change.amount : 0 }];
  const amounts = calculateOrderAmounts(
    order.orderItems.map((item) => ({ unitPrice: item.unitPrice, quantity: item.quantity })),
    nextAdjustments,
  );

  const account = order.receivable
    ? await tx.creditAccount.findUnique({
      where: { userId: order.receivable.userId },
      select: { usedAmount: true },
    })
    : null;
  const before = {
    total: order.total,
    adjustmentTotal: order.adjustmentTotal,
    receivableAmount: order.receivable?.amount ?? null,
    receivableStatus: order.receivable?.status ?? null,
    usedAmount: account?.usedAmount ?? null,
  };

  const adjustment = input.change.op === 'create'
    ? await tx.orderAdjustment.create({
      data: {
        orderId: order.id,
        type: input.change.type,
        label: input.change.label,
        amount: input.change.amount,
        reason: input.change.reason,
        createdBy: input.actor.id,
      },
    })
    : null;
  if (removed) await tx.orderAdjustment.delete({ where: { id: removed.id } });

  const updated = await tx.order.update({
    where: { id: order.id },
    data: {
      ...amounts,
      events: {
        create: {
          type: 'amount_recalculated',
          actorId: input.actor.id,
          actorEmail: input.actor.email,
          metadata: JSON.stringify(amounts),
        },
      },
    },
  });
  const synced = await syncUnsettledReceivableAmount(tx, order.id, amounts.total, input.actor.id);

  await writeAuditLog({
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    action: 'order.amount_adjusted',
    resource: 'orders',
    targetType: 'Order',
    targetId: order.id,
    before,
    after: {
      total: updated.total,
      adjustmentTotal: updated.adjustmentTotal,
      receivableAmount: synced?.amount ?? null,
      receivableStatus: synced?.status ?? null,
      usedAmount: synced?.usedAmount ?? null,
    },
    reason: input.change.op === 'create' ? input.change.reason : removed?.reason ?? null,
    metadata: {
      operation: input.change.op,
      adjustmentId: adjustment?.id ?? removed?.id ?? null,
      amount: input.change.op === 'create' ? input.change.amount : removed?.amount ?? null,
    },
  }, tx);

  return {
    adjustmentId: adjustment?.id ?? null,
    adjustment,
    total: updated.total,
  };
}
