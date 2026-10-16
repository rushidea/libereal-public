import { describe, expect, it } from 'vitest';
import {
  buildPointsRedeemBreakdown,
  calculateCumulativePointsRefund,
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

  it('returns the rest of the original points once cumulative cash reaches the payable amount', () => {
    const base = {
      originalPersonal: 10,
      originalGroup: 0,
      refundedPersonal: 0,
      refundedGroup: 0,
      refundedCashYuan: 0,
      originalPaidYuan: 100,
    };
    const first = calculateCumulativePointsRefund({ ...base, refundYuan: 50 });
    expect(first).toEqual({ ok: true, personal: 5, group: 0, nextCashYuan: 50 });
    if (!first.ok) return;
    const second = calculateCumulativePointsRefund({
      ...base,
      refundedPersonal: first.personal,
      refundedCashYuan: first.nextCashYuan,
      refundYuan: 50,
    });
    expect(second).toEqual({ ok: true, personal: 5, group: 0, nextCashYuan: 100 });
  });

  it('keeps the personal and group split stable across partial refunds', () => {
    const first = calculateCumulativePointsRefund({
      originalPersonal: 60,
      originalGroup: 40,
      refundedPersonal: 0,
      refundedGroup: 0,
      refundedCashYuan: 0,
      refundYuan: 50,
      originalPaidYuan: 100,
    });
    expect(first).toMatchObject({ ok: true, personal: 30, group: 20, nextCashYuan: 50 });
    const second = calculateCumulativePointsRefund({
      originalPersonal: 60,
      originalGroup: 40,
      refundedPersonal: 30,
      refundedGroup: 20,
      refundedCashYuan: 50,
      refundYuan: 50,
      originalPaidYuan: 100,
    });
    expect(second).toMatchObject({ ok: true, personal: 30, group: 20, nextCashYuan: 100 });
  });

  it('releases the floored remainder only when the last cash refund completes the payable amount', () => {
    let refundedPersonal = 0;
    let refundedCashYuan = 0;
    const slices = [33, 33, 34];
    const returned: number[] = [];
    for (const refundYuan of slices) {
      const plan = calculateCumulativePointsRefund({
        originalPersonal: 10,
        originalGroup: 0,
        refundedPersonal,
        refundedGroup: 0,
        refundedCashYuan,
        refundYuan,
        originalPaidYuan: 100,
      });
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;
      returned.push(plan.personal);
      refundedPersonal += plan.personal;
      refundedCashYuan = plan.nextCashYuan;
    }
    expect(returned).toEqual([3, 3, 4]);
    expect(refundedPersonal).toBe(10);
  });

  it('rejects a refund above the original payable or the remaining cash', () => {
    expect(calculateCumulativePointsRefund({
      originalPersonal: 10,
      originalGroup: 0,
      refundedPersonal: 0,
      refundedGroup: 0,
      refundedCashYuan: 0,
      refundYuan: 150,
      originalPaidYuan: 100,
    })).toEqual({ ok: false, error: '退款金额不能超过原应付金额' });

    expect(calculateCumulativePointsRefund({
      originalPersonal: 10,
      originalGroup: 0,
      refundedPersonal: 5,
      refundedGroup: 0,
      refundedCashYuan: 50,
      refundYuan: 60,
      originalPaidYuan: 100,
    })).toEqual({ ok: false, error: '退款金额超过剩余可退金额' });
  });

  it('treats a full payable refund as settlement and returns every point still held', () => {
    expect(calculateCumulativePointsRefund({
      originalPersonal: 6,
      originalGroup: 4,
      refundedPersonal: 3,
      refundedGroup: 2,
      refundedCashYuan: 50,
      refundYuan: 100,
      originalPaidYuan: 100,
    })).toEqual({ ok: true, personal: 3, group: 2, nextCashYuan: 100 });
  });
});
