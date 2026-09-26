import { describe, expect, it } from 'vitest';
import { calculateCheckoutFeeAdjustments } from '@/lib/checkout-fees';

describe('generic checkout fee policy', () => {
  it('adds no merchant fees with public defaults', () => {
    expect(calculateCheckoutFeeAdjustments(100, true)).toEqual([]);
  });
  it('calculates configured fee types without embedding merchant policy', () => {
    expect(calculateCheckoutFeeAdjustments(100, true, { platformRate: 0.1, transferFee: 5 })).toEqual([
      { type: 'platform_fee', label: 'Platform service fee', amount: 10 },
      { type: 'transfer_fee', label: 'Transfer fee', amount: 5 },
    ]);
  });
});
