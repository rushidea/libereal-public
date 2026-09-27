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

/** Preserve payment settlement while rolling back a failed legacy points deduction. */
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
    return { ok: false, error: error instanceof Error ? error.message : '积分结算失败' };
  }
}
