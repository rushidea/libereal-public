export const receivableCashAmounts = { amountCents: true, releasedCents: true } as const;
export const receivableOrderBalance = { total: true, cashPostings: { select: receivableCashAmounts } } as const;

type PostedAmount = { amountCents: bigint | number; releasedCents: bigint | number };

export function receivableOutstandingCents(amount: number, status: string, postings: PostedAmount[], orderTotal: number) {
  if (status === 'paid' || status === 'cancelled') return 0;
  const released = postings.reduce((sum, row) => sum + Number(row.releasedCents), 0);
  const received = postings.reduce((sum, row) => sum + Number(row.amountCents), 0);
  return Math.max(0, Math.min(Math.round(amount * 100) - released, Math.round(orderTotal * 100) - received));
}

export function receivableOutstanding(amount: number, status: string, postings: PostedAmount[], orderTotal: number) {
  return receivableOutstandingCents(amount, status, postings, orderTotal) / 100;
}

export function receivableView<T extends { amount: number; status: string }>(
  row: T, order: { total: number; cashPostings: PostedAmount[] },
) {
  return { ...row, originalAmount: row.amount, amount: receivableOutstanding(row.amount, row.status, order.cashPostings, order.total) };
}
