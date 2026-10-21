import { describe, expect, it } from 'vitest';
import { ADMIN_ACTING_POINTS_ERROR, adminActingPointsError, quoteConfirmSettlementFields } from '@/lib/admin-acting-points';

describe('admin acting points guard', () => {
  it('rejects a positive personal or group redemption and ignores empty values', () => {
    expect(adminActingPointsError({ personalPoints: 1 })).toBe(ADMIN_ACTING_POINTS_ERROR);
    expect(adminActingPointsError({ groupPoints: '8', groupId: 'g1' })).toBe(ADMIN_ACTING_POINTS_ERROR);
    expect(adminActingPointsError({})).toBeNull();
    expect(adminActingPointsError({ personalPoints: 0, groupPoints: 0, groupId: 'g1' })).toBeNull();
    expect(adminActingPointsError({ personalPoints: -3, groupPoints: 'nope' })).toBeNull();
  });

  it('strips points from an admin quote confirmation and keeps the customer payload', () => {
    expect(quoteConfirmSettlementFields({
      actorRole: 'admin',
      paymentMethod: 'alipay',
      personalPoints: 12,
      groupPoints: 4,
      groupId: 'g1',
    })).toEqual({ paymentMethod: 'alipay', personalPoints: 0, groupPoints: 0 });

    expect(quoteConfirmSettlementFields({
      actorRole: 'customer',
      paymentMethod: 'alipay',
      personalPoints: 12,
      groupPoints: 4,
      groupId: 'g1',
    })).toEqual({ paymentMethod: 'alipay', personalPoints: 12, groupPoints: 4, groupId: 'g1' });
  });
});