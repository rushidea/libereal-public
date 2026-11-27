import type { Prisma } from '@prisma/client';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { purchaseObject } from '@/lib/purchase-activity';

export const receivableCashAmounts = { amountCents: true, releasedCents: true } as const;
export const receivablePrincipalEvents = {
  where: { action: 'verify_receivable_principal' },
  select: { id: true, action: true, detail: true, actorId: true, approvedHash: true },
  orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }], take: 1,
};
export const receivableOrderBalance = {
  id: true, total: true, customerId: true, cashPostings: { select: receivableCashAmounts }, financeEvents: receivablePrincipalEvents,
} as const;

type PostedAmount = { amountCents: bigint | number; releasedCents: bigint | number };
type PrincipalOrder = { id: string; total: number; customerId: string | null };
type OriginalReceivable = { id: string; userId: string; amount: number };
type PrincipalEvent = Prisma.FinanceEventGetPayload<{ select: typeof receivablePrincipalEvents.select }>;

export function receivablePrincipal(order: PrincipalOrder, ar: OriginalReceivable | null, events: PrincipalEvent[] = []) {
  const face = Math.round(order.total * 100);
  if (Number.isSafeInteger(face) && face > 0) return { cents: face, reviewId: null };
  if (!ar || order.customerId !== ar.userId) return null;
  const cents = Math.round(ar.amount * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  const review = events.findLast(row => row.action === 'verify_receivable_principal');
  if (!review || !review.approvedHash || !review.actorId) return null;
  const detail = jsonObject(review.detail);
  const op = purchaseObject(detail.operation);
  const authorization = purchaseObject(detail.authorization);
  if (op.orderId !== order.id || op.receivableId !== ar.id || op.debtorId !== ar.userId || op.amountCents !== cents
    || op.orderFaceCents !== face || op.ownerId !== review.actorId || !op.acceptanceId
    || authorization.permission !== 'finance.write' || authorization.action !== 'admin_sensitive') return null;
  return { cents, reviewId: review.id };
}

export async function readReceivablePrincipal(tx: Prisma.TransactionClient, order: PrincipalOrder, ar: OriginalReceivable | null) {
  const face = receivablePrincipal(order, ar);
  if (face || !ar) return face;
  const events = await tx.financeEvent.findMany({ ...receivablePrincipalEvents, where: { ...receivablePrincipalEvents.where, orderId: order.id } });
  return receivablePrincipal(order, ar, events);
}

export function receivableOutstandingCents(amount: number, status: string, postings: PostedAmount[], orderTotal: number) {
  if (status === 'paid' || status === 'cancelled') return 0;
  const released = postings.reduce((sum, row) => sum + Number(row.releasedCents), 0);
  const received = postings.reduce((sum, row) => sum + Number(row.amountCents), 0);
  const recorded = Math.round(amount * 100) - released;
  const face = Math.round(orderTotal * 100);
  return Math.max(0, face > 0 ? Math.min(recorded, face - received) : recorded);
}

export function receivableOutstanding(amount: number, status: string, postings: PostedAmount[], orderTotal: number) {
  return receivableOutstandingCents(amount, status, postings, orderTotal) / 100;
}

export function collectibleReceivableCents(
  row: OriginalReceivable & { status: string },
  order: PrincipalOrder & { cashPostings: PostedAmount[]; financeEvents: PrincipalEvent[] },
) {
  const confirmed = receivablePrincipal(order, row, order.financeEvents);
  return confirmed ? receivableOutstandingCents(row.amount, row.status, order.cashPostings, confirmed.cents / 100) : 0;
}

export function receivableView<T extends { amount: number; status: string }>(
  row: T, order: { total: number; cashPostings: PostedAmount[] },
) {
  return { ...row, originalAmount: row.amount, amount: receivableOutstanding(row.amount, row.status, order.cashPostings, order.total) };
}
