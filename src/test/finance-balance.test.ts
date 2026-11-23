import { describe, expect, it } from 'vitest';
import { receivableOutstanding } from '@/lib/receivable-balance';

describe('original receivable and actual receipts', () => {
  it('keeps the outstanding amount correct when credit covers only the unpaid balance', () => {
    const earlier = [{ amountCents: 5000, releasedCents: 0 }];
    const receipts = [...earlier, { amountCents: 2000, releasedCents: 2000 }];
    expect(receivableOutstanding(100, 'open', earlier, 100)).toBe(50);
    expect(receivableOutstanding(50, 'open', earlier, 100)).toBe(50);
    expect(receivableOutstanding(50, 'overdue', receipts, 100)).toBe(30);
    expect(receivableOutstanding(100, 'overdue', receipts, 100)).toBe(30);
    expect(receivableOutstanding(50, 'paid', receipts, 100)).toBe(0);
  });
});
