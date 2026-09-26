import { describe, expect, it } from 'vitest';
import { nextOrderNumber, orderDateInShanghai } from '@/data/order-number';

describe('order number', () => {
  it('uses the Shanghai calendar date around UTC midnight', () => {
    expect(orderDateInShanghai(new Date('2026-07-15T16:18:00.000Z'))).toBe('20260716');
    expect(orderDateInShanghai(new Date('2026-07-15T15:59:59.999Z'))).toBe('20260715');
  });

  it('starts at one and increments the latest sequence', () => {
    const date = new Date('2026-07-15T16:18:00.000Z');

    expect(nextOrderNumber(date, null)).toBe('ORD-20260716-001');
    expect(nextOrderNumber(date, 'ORD-20260716-009')).toBe('ORD-20260716-010');
  });

  it('ignores an order number from another date', () => {
    const date = new Date('2026-07-15T16:18:00.000Z');

    expect(nextOrderNumber(date, 'ORD-20260715-999')).toBe('ORD-20260716-001');
  });
});
