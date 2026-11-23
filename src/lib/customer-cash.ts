import type { Prisma } from '@prisma/client';
import { finishCustomerReceivable, isUnsettledReceivableStatus } from '@/lib/customer-credit';
import { readPurchaseActivities } from '@/lib/purchase-activity';
import { orderReceiptEvidence } from '@/lib/purchase-receipts';
import { loadPurchaseOrderSource, type SourceOrder } from '@/lib/purchase-source';
import { PurchaseError } from '@/lib/purchase-terms';

type Db = Prisma.TransactionClient;
export type CustomerCashSource = { bankAllocationId: string } | { paymentAttemptId: string };

const cents = (yuan: number) => Math.round(yuan * 100);

export function receivableOutstanding(amount: number, status: string, postings: Array<{ releasedCents: bigint | number }>) {
  if (status === 'paid' || status === 'cancelled') return 0;
  return Math.max(0, cents(amount) - postings.reduce((total, row) => total + Number(row.releasedCents), 0)) / 100;
}

export function receivableView<T extends { amount: number; status: string; cashPostings: Array<{ releasedCents: bigint }> }>(row: T) {
  const { cashPostings, ...view } = row;
  return { ...view, originalAmount: row.amount, amount: receivableOutstanding(row.amount, row.status, cashPostings) };
}

// A legacy order may have reserved only the balance after its deposit.
export async function orderCreditHeldCents(tx: Db, order: SourceOrder) {
  const ledger = order.creditTransactions;
  const reserves = ledger.filter(row => row.type === 'reserve');
  if (!order.customerId || reserves.length !== 1 || reserves[0].amount <= 0) return null;
  const releases = ledger.filter(row => row.type === 'release');
  const postings = releases.length ? await tx.customerCashPosting.findMany({
    where: { orderId: order.id, creditTransactionId: { not: null } },
    select: { creditTransactionId: true, releasedCents: true, receivableId: true },
  }) : [];
  const linked = new Map(postings.map(row => [row.creditTransactionId, row]));
  let balance = 0;
  for (const row of ledger) {
    if (!['reserve', 'amount_adjust', 'release'].includes(row.type) || row.userId !== order.customerId) return null;
    const amount = cents(row.amount);
    if (!Number.isSafeInteger(amount)) return null;
    if (row.type === 'release') {
      const post = linked.get(row.id);
      if (!post || !order.receivable || post.receivableId !== order.receivable.id
        || amount >= 0 || Number(post.releasedCents) !== -amount) return null;
    }
    balance += amount;
  }
  return Number.isSafeInteger(balance) && balance >= 0 && balance <= cents(order.total) ? balance : null;
}

export async function customerCashProjection(tx: Db, order: SourceOrder, amount: number) {
  const previous = await tx.customerCashPosting.findMany({ where: { orderId: order.id } });
  const before = previous.reduce((sum, row) => sum + Number(row.amountCents), 0);
  const face = cents(order.total);
  const remaining = face - before - amount;
  if (!Number.isSafeInteger(remaining) || remaining < 0) throw new PurchaseError('本次归入金额超过未核销的订单余额');
  const ar = order.receivable;
  if (ar && !isUnsettledReceivableStatus(ar.status)) throw new PurchaseError('原应收已经结清或关闭，请核对原始账务');
  const held = ar ? await orderCreditHeldCents(tx, order) : 0;
  const account = ar ? await tx.creditAccount.findUnique({ where: { userId: ar.userId } }) : null;
  if (held === null || ar && (ar.userId !== order.customerId || !account || cents(account.usedAmount) < held
    || held > cents(ar.amount) || held > face - before)) throw new PurchaseError('应收或已占授信与原单不符，请核对原始账务');
  const released = Math.min(amount, Math.max(0, held - remaining));
  return { amountCents: amount, postedBeforeCents: before, remainingCents: remaining, receivableId: ar?.id ?? null,
    releaseCents: released, orderCreditAfterCents: held - released, accountId: account?.id ?? null,
    accountUsedBefore: account?.usedAmount ?? null, accountUsedAfter: account ? (cents(account.usedAmount) - released) / 100 : null };
}

export async function postVerifiedCustomerCash(tx: Db, orderId: string, source: CustomerCashSource, actorId: string) {
  const existing = await tx.customerCashPosting.findUnique({ where: source });
  if (existing) {
    if (existing.orderId !== orderId) throw new PurchaseError('到账记录已经关联其他订单');
    return existing.id;
  }
  const order = await loadPurchaseOrderSource(tx, orderId);
  const activities = await readPurchaseActivities(tx, orderId);
  const face = cents(order.total);
  const { payment } = await orderReceiptEvidence(tx, order, activities, face);
  const bankId = 'bankAllocationId' in source ? source.bankAllocationId : null;
  const entry = payment.receipts.find(row => row.counted && row.id === bankId);
  const native = 'paymentAttemptId' in source && source.paymentAttemptId === payment.paymentAttemptId;
  const amount = native ? face : entry?.amountCents;
  const occurredAt = native ? payment.nativePaidAt : entry?.occurredAt;
  if (!amount || !Number.isSafeInteger(amount) || typeof occurredAt !== 'string' || !Number.isFinite(Date.parse(occurredAt))) {
    throw new PurchaseError('须核对原订单的平台交易或已核验的银行到账分摊');
  }
  const previous = await tx.customerCashPosting.findMany({ where: { orderId } });
  const ar = order.receivable;
  if ((payment.paymentAttemptId && payment.allocatedCents > 0) || order.paidAt && !native
    || previous.some(row => row.bankAllocationId && !payment.receipts.some(item => item.counted && item.id === row.bankAllocationId))) {
    throw new PurchaseError('已有付款日期或不同来源的到账记录需要财务核对，不能再次核销');
  }
  const projection = await customerCashProjection(tx, order, amount);
  const released = projection.releaseCents;
  const remaining = projection.remainingCents;
  let creditTransactionId: string | null = null;
  if (ar && projection.accountId && projection.accountUsedAfter !== null && projection.accountUsedBefore !== null) {
    if (released) {
      const balanceAfter = projection.accountUsedAfter;
      const changed = await tx.creditAccount.updateMany({
        where: { id: projection.accountId, usedAmount: projection.accountUsedBefore }, data: { usedAmount: balanceAfter },
      });
      if (changed.count !== 1) throw new PurchaseError('客户授信占用发生变化，请重新核对');
      const credit = await tx.creditTransaction.create({ data: {
        userId: ar.userId, orderId, type: 'release', amount: -released / 100, balanceAfter,
        reason: '按已核验的实际回款核销', actorId,
      } });
      creditTransactionId = credit.id;
    }
  }
  const posted = await tx.customerCashPosting.create({ data: {
    orderId, ...source, amountCents: BigInt(amount), releasedCents: BigInt(released),
    receivableId: ar?.id, creditTransactionId, actorId,
  } });
  if (remaining === 0) {
    const linked = new Set(previous.map(row => row.bankAllocationId).concat(bankId));
    const paymentDates = payment.receipts.filter(row => row.counted && linked.has(row.id))
      .map(row => Date.parse(String(row.occurredAt)));
    const paidAt = new Date(Math.max(Date.parse(occurredAt), ...paymentDates));
    if (ar) await finishCustomerReceivable(tx, ar, paidAt);
    else if (!order.paidAt) await tx.order.update({ where: { id: orderId }, data: { paidAt } });
  }
  return posted.id;
}
