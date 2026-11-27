import type { Prisma } from '@prisma/client';
import { creditLimitForAccount } from '@/lib/customer-credit';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { purchaseObject } from '@/lib/purchase-activity';
import type { SourceOrder } from '@/lib/purchase-source';

type Db = Prisma.TransactionClient;

function money(value: number) {
  return Math.round(value * 100);
}

export function creditLimitTerms(value: unknown) {
  const raw = purchaseObject(value);
  const { baseLimit, overrideLimit, temporaryLimit, temporaryUntil, status } = raw;
  if (typeof baseLimit !== 'number' || !Number.isFinite(baseLimit) || typeof temporaryLimit !== 'number' || !Number.isFinite(temporaryLimit)
    || (overrideLimit !== null && (typeof overrideLimit !== 'number' || !Number.isFinite(overrideLimit))) || typeof status !== 'string') return null;
  const until = temporaryUntil === null ? null : typeof temporaryUntil === 'string' || temporaryUntil instanceof Date ? new Date(temporaryUntil) : null;
  if (temporaryUntil !== null && (!until || !Number.isFinite(until.getTime()))) return null;
  return { baseLimit, overrideLimit, temporaryLimit, temporaryUntil: until?.toISOString() ?? null, status };
}

type LimitTerms = NonNullable<ReturnType<typeof creditLimitTerms>>;

export type PurchaseCreditEvidence = {
  receivableId: string; reserveId: string; accountId: string; userId: string; owedCents: number;
  occupiedCents: number; limitCents: number; paymentTermDays: number; dueAt: string | null;
};

function limitAt(terms: LimitTerms, time: number) {
  return money(creditLimitForAccount({ ...terms, temporaryUntil: terms.temporaryUntil ? new Date(terms.temporaryUntil) : null }, new Date(time)));
}

const sameTerms = (left: LimitTerms, right: LimitTerms) => pricingContentHash(left) === pricingContentHash(right);

export async function purchaseCreditAt(tx: Db, order: SourceOrder, approvedBasis: unknown, approvedAt: number, at: number, owedCents: number) {
  const unproven = (reason: string) => ({ status: 'unproven' as const, reason, credit: null, auditIds: [] as string[], balanceId: null });
  if (!owedCents) return { status: 'not_required' as const, credit: null, auditIds: [], balanceId: null };
  const basis = purchaseObject(approvedBasis);
  const signed = purchaseObject(basis.credit);
  const ar = order.receivable;
  const reserve = order.creditTransactions.find(row => row.id === (signed.reserveId ?? basis.reserveId) && row.type === 'reserve');
  const allowedAmounts = [money(order.total), owedCents];
  const userId = order.customerId;
  if (!userId || !ar || ar.id !== (signed.receivableId ?? basis.receivableId) || !reserve || reserve.userId !== userId || ar.userId !== userId
    || (signed.userId && signed.userId !== userId) || reserve.createdAt.getTime() > approvedAt || ar.confirmedAt.getTime() > approvedAt
    || !allowedAmounts.includes(money(ar.amount)) || !allowedAmounts.includes(money(reserve.amount))
    || order.creditTransactions.some(row => row.type === 'release' && row.createdAt.getTime() <= at)) return unproven('reservation_not_proven');
  const account = await tx.creditAccount.findUnique({ where: { userId } });
  const current = creditLimitTerms(account);
  if (!account || !current || account.createdAt.getTime() > approvedAt || (signed.accountId && signed.accountId !== account.id)) return unproven('account_not_proven');

  const audit = await tx.auditLog.findMany({ where: { resource: 'customers', targetType: 'CreditAccount', targetId: account.id,
    action: 'customer.credit_changed', createdAt: { gte: new Date(approvedAt) } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const accountTerms = (value: string | null) => {
    const state = jsonObject(value);
    return state.id === account.id && state.userId === userId ? creditLimitTerms(state) : null;
  };
  const changes = audit.map(row => ({ row, before: row.actorId ? accountTerms(row.beforeData) : null, after: row.actorId ? accountTerms(row.afterData) : null }));
  const dated = changes.filter(({ before, after }) => !before || !after || !sameTerms(before, after));
  const accountTime = account.updatedAt.getTime();
  let terms = current;
  const useCurrent = accountTime < at && !dated.some(change => change.row.createdAt.getTime() >= at);
  if (!useCurrent) {
    let previous = creditLimitTerms(basis.creditTerms) ?? dated[0]?.before;
    if (!previous || (typeof signed.limitCents === 'number' && limitAt(previous, approvedAt) !== signed.limitCents)) return unproven('approval_limit_not_proven');
    terms = previous;
    for (const { row, before, after } of dated) {
      const time = row.createdAt.getTime();
      if (time === at) return unproven('change_time_ambiguous');
      if (!before || !after || !sameTerms(previous, before)) return unproven('limit_history_incomplete');
      if (time < at) terms = after;
      previous = after;
    }
    if (!sameTerms(previous, current)) return unproven('limit_history_incomplete');
  }

  const balances = await tx.creditTransaction.findMany({ where: { userId, createdAt: { gte: reserve.createdAt, lte: new Date(at) } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const last = balances.at(-1);
  const lastGroup = last ? balances.filter(row => row.createdAt.getTime() === last.createdAt.getTime()) : [];
  if (!useCurrent && lastGroup.some(row => money(row.balanceAfter) !== money(last!.balanceAfter))) return unproven('balance_time_ambiguous');
  const occupiedCents = useCurrent ? money(account.usedAmount) : last ? money(last.balanceAfter) : NaN;
  const limitCents = limitAt(terms, at);
  if (!Number.isSafeInteger(occupiedCents) || occupiedCents < owedCents || !Number.isSafeInteger(limitCents) || limitCents < 0
    || (last && last.id !== reserve.id && last.type !== 'admin_adjust' && last.createdAt.getTime() === at && at > approvedAt)) return unproven('balance_not_proven');
  const credit: PurchaseCreditEvidence = { receivableId: ar.id, reserveId: reserve.id, accountId: account.id, userId,
    owedCents, occupiedCents, limitCents, paymentTermDays: ar.paymentTermDaysSnapshot,
    dueAt: ar.termStartedAt && ar.termStartedAt.getTime() <= at ? ar.dueAt?.toISOString() ?? null : null };
  return { status: !['active', 'credit_limited'].includes(terms.status) ? 'restricted' as const
    : occupiedCents > credit.limitCents ? 'over_limit' as const : 'within_limit' as const,
  credit, auditIds: audit.map(row => row.id), balanceId: last?.id ?? null };
}
