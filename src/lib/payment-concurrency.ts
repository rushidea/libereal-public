import type { Prisma } from '@prisma/client';

// These older outcomes were only written after accepting a successful gateway callback.
export const legacyAlipayReconciliationStatuses = ['rejected_order_cancelled', 'rejected_amount_mismatch'];

export function isAlipayReconciliationStatus(status: string | null | undefined) {
  const value = status?.toLowerCase() ?? '';
  return value.endsWith('_reconciliation_required') || legacyAlipayReconciliationStatuses.includes(value);
}

const alipayReconciliationWhere = {
  provider: 'alipay',
  OR: [{ status: { endsWith: '_reconciliation_required' } }, { status: { in: legacyAlipayReconciliationStatuses } }],
} satisfies Prisma.PaymentAttemptWhereInput;

export const alipayReconciliationCount = { select: { paymentAttempts: { where: alipayReconciliationWhere } } } as const;
export const alipayReceiptWhere = {
  provider: 'alipay',
  OR: [...alipayReconciliationWhere.OR, { status: { in: ['paid', 'TRADE_SUCCESS', 'TRADE_FINISHED'] } }],
} satisfies Prisma.PaymentAttemptWhereInput;

/**
 * Shared payment-attempt concurrency rules.
 *
 * Keep this list in lockstep with the partial unique index used by the
 * payment-attempt migration. Terminal attempts stay historical and may be
 * retained more than once for an order/provider.
 */
export const ACTIVE_PAYMENT_ATTEMPT_STATUSES = ['created', 'redirected', 'WAIT_BUYER_PAY'] as const;

export type ActivePaymentAttemptStatus = (typeof ACTIVE_PAYMENT_ATTEMPT_STATUSES)[number];

export function isActivePaymentAttemptStatus(status: string): status is ActivePaymentAttemptStatus {
  return (ACTIVE_PAYMENT_ATTEMPT_STATUSES as readonly string[]).includes(status);
}

export function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/**
 * Run points deduction inside a savepoint.
 * A returned failure leaves the surrounding payment writes in place.
 * An unexpected exception rolls the deduction back and propagates, so the
 * payment transaction aborts and Alipay can retry the notification.
 */
export async function settlePaymentPoints(
  tx: import('@prisma/client').Prisma.TransactionClient,
  orderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { applyOrderPointsDeduction } = await import('./points-checkout-service');
  await tx.$executeRawUnsafe('SAVEPOINT payment_points_settlement');
  try {
    const result = await applyOrderPointsDeduction(tx, orderId);
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT payment_points_settlement');
    return result;
  } catch (error) {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT payment_points_settlement');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT payment_points_settlement');
    throw error;
  }
}
