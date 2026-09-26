import { describe, expect, it } from 'vitest';
import {
  buildPointsRedeemBreakdown,
  calculateProportionalPointsRefund,
  normalizePointsIntent,
  splitProportionalRefund,
} from '@/lib/points-checkout';

describe('points checkout', () => {
  it('normalizes intent to non-negative integers', () => {
    expect(normalizePointsIntent({ personalPoints: 12.9, groupPoints: -3, groupId: ' g1 ' })).toEqual({
      personalPoints: 12,
      groupPoints: 0,
      groupId: 'g1',
    });
  });

  it('builds 1:1 redeem breakdown within payable and balances', () => {
    const result = buildPointsRedeemBreakdown({
      payableBeforePoints: 199.5,
      personalBalance: 100,
      groupBalance: 80,
      intent: { personalPoints: 50, groupPoints: 40, groupId: 'g1' },
      membershipGroupId: 'g1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.breakdown.pointsDiscount).toBe(90);
    expect(result.breakdown.payableAfterPoints).toBe(109.5);
  });

  it('rejects overspend and foreign group', () => {
    expect(
      buildPointsRedeemBreakdown({
        payableBeforePoints: 50,
        personalBalance: 100,
        groupBalance: 100,
        intent: { personalPoints: 60, groupPoints: 0, groupId: null },
        membershipGroupId: null,
      }).ok,
    ).toBe(false);

    expect(
      buildPointsRedeemBreakdown({
        payableBeforePoints: 100,
        personalBalance: 0,
        groupBalance: 100,
        intent: { personalPoints: 0, groupPoints: 10, groupId: 'g2' },
        membershipGroupId: 'g1',
      }).ok,
    ).toBe(false);
  });

  it('splits proportional refund preferring personal remainder', () => {
    expect(calculateProportionalPointsRefund({
      originalPoints: 100,
      refundYuan: 50,
      originalPaidYuan: 100,
    })).toBe(50);

    expect(splitProportionalRefund({
      personalPoints: 60,
      groupPoints: 40,
      refundYuan: 50,
      originalPaidYuan: 100,
    })).toEqual({ personal: 30, group: 20 });
  });
});
