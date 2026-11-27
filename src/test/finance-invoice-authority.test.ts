import { describe, expect, it } from 'vitest';
import { datedInvoiceChargesWorsen, invoiceAuthorityTimeline } from '@/lib/finance-invoice-authority';

const date = (day: number) => new Date(Date.UTC(2031, 4, day)).toISOString();
const a = { id: 'office-item-A', quantity: 1 };
const b = { id: 'office-item-B', quantity: 1 };
const timeline = invoiceAuthorityTimeline([
  { id: 'original', grossCents: 6000, occurredAt: date(1), lines: [a, b], change: null },
  { id: 'B-only', grossCents: 4000, occurredAt: date(2), lines: [b], change: { mode: 'increase', amountCents: 4000 } },
  { id: 'cumulative', grossCents: 10000, occurredAt: date(3), lines: [a, b], change: { mode: 'restate', amountCents: 10000 } },
]);
const charge = (id: string, scopeId: string, amountCents: number, day: number) =>
  ({ id, number: id, scopeId, amountCents, issuedAt: date(day), status: 'recorded' });

describe('dated invoice constraints', () => {
  it('checks the total even while a larger deficit remains in the common scope', () => {
    const before = [charge('first-50', 'original', 5000, 1), charge('later-20', 'cumulative', 2000, 5),
      charge('independent-20', 'B-only', 2000, 4)];
    expect(datedInvoiceChargesWorsen(timeline, before, [...before, charge('independent-10', 'B-only', 1000, 4)])).toBe(false);
    expect(datedInvoiceChargesWorsen(timeline, before, [...before, charge('independent-10.01', 'B-only', 1001, 4)])).toBe(true);
  });

  it('rejects moving a cent into an overused dedicated scope even with the same total and invoice ids', () => {
    const before = [charge('first-50', 'original', 5000, 1), charge('later-20', 'cumulative', 2000, 5),
      charge('independent-41', 'B-only', 4100, 5)];
    const after = [before[0], { ...before[1], amountCents: 1999 }, { ...before[2], amountCents: 4101 }];
    expect(datedInvoiceChargesWorsen(timeline, before, after)).toBe(true);
    expect(datedInvoiceChargesWorsen(timeline, after, before)).toBe(true);
  });
});
