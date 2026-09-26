import { describe, it, expect } from 'vitest';
import {
  calculateOrderPoints,
  canRedeem,
  validatePointsDelta,
  validatePointsTarget,
  formatPoints,
  POINTS_LOG_TYPE_LABELS,
  PRODUCT_CATEGORY_LABELS,
} from '@/lib/points';

describe('calculateOrderPoints', () => {
  it('returns 0 when points system inactive', () => {
    expect(calculateOrderPoints(100, 1, false)).toBe(0);
  });

  it('returns 0 for zero or negative amount', () => {
    expect(calculateOrderPoints(0, 1, true)).toBe(0);
    expect(calculateOrderPoints(-50, 1, true)).toBe(0);
  });

  it('awards one point per completed thousand yuan', () => {
    expect(calculateOrderPoints(999, 0.001, true)).toBe(0);
    expect(calculateOrderPoints(1000, 0.001, true)).toBe(1);
    expect(calculateOrderPoints(10_500, 0.001, true)).toBe(10);
  });

  it('handles large orders', () => {
    expect(calculateOrderPoints(99_999, 0.001, true)).toBe(99);
  });
});

describe('canRedeem', () => {
  it('returns true when user has enough points', () => {
    expect(canRedeem(100, 50)).toBe(true);
    expect(canRedeem(50, 50)).toBe(true); // 正好等于
  });

  it('returns false when user has insufficient points', () => {
    expect(canRedeem(40, 50)).toBe(false);
  });

  it('returns false when cost is zero or negative', () => {
    expect(canRedeem(100, 0)).toBe(false);
    expect(canRedeem(100, -10)).toBe(false);
  });
});

describe('validatePointsDelta', () => {
  it('accepts positive integer', () => {
    expect(validatePointsDelta(100)).toEqual({ valid: true });
    expect(validatePointsDelta(1)).toEqual({ valid: true });
  });

  it('accepts negative integer (subtraction)', () => {
    expect(validatePointsDelta(-100)).toEqual({ valid: true });
  });

  it('rejects zero (no change)', () => {
    expect(validatePointsDelta(0)).toEqual({ valid: false, error: '积分变动不能为 0' });
  });

  it('rejects non-integer', () => {
    expect(validatePointsDelta(1.5)).toEqual({ valid: false, error: '积分变动必须为整数' });
    expect(validatePointsDelta(-0.5)).toEqual({ valid: false, error: '积分变动必须为整数' });
  });

  it('rejects magnitudes > 1,000,000', () => {
    expect(validatePointsDelta(1000001)).toEqual({ valid: false, error: '单次变动不能超过 1,000,000' });
    expect(validatePointsDelta(-1000001)).toEqual({ valid: false, error: '单次变动不能超过 1,000,000' });
  });

  it('accepts boundary 1,000,000', () => {
    expect(validatePointsDelta(1000000)).toEqual({ valid: true });
    expect(validatePointsDelta(-1000000)).toEqual({ valid: true });
  });
});

describe('validatePointsTarget', () => {
  it('accepts zero and the maximum balance', () => {
    expect(validatePointsTarget(0)).toEqual({ valid: true });
    expect(validatePointsTarget(1000000)).toEqual({ valid: true });
  });

  it('rejects a negative, fractional, or oversized balance', () => {
    expect(validatePointsTarget(-1)).toEqual({ valid: false, error: '目标积分不能为负' });
    expect(validatePointsTarget(1.5)).toEqual({ valid: false, error: '目标积分必须为整数' });
    expect(validatePointsTarget(1000001)).toEqual({ valid: false, error: '目标积分不能超过 1,000,000' });
  });
});

describe('formatPoints', () => {
  it('formats with thousand separators', () => {
    expect(formatPoints(1234)).toBe('1,234');
    expect(formatPoints(1234567)).toBe('1,234,567');
  });

  it('handles zero and negatives', () => {
    expect(formatPoints(0)).toBe('0');
    expect(formatPoints(-500)).toBe('-500');
  });
});

describe('POINTS_LOG_TYPE_LABELS completeness', () => {
  it('has all log types', () => {
    expect(Object.keys(POINTS_LOG_TYPE_LABELS).sort()).toEqual(
      [
        'admin_adjust',
        'admin_inject',
        'admin_undo',
        'order_credit',
        'order_redeem',
        'order_redeem_refund',
        'redemption',
        'topup_alipay',
      ],
    );
  });

  it('has chinese labels for all types', () => {
    for (const label of Object.values(POINTS_LOG_TYPE_LABELS)) {
      expect(label).toMatch(/[\u4e00-\u9fa5]/);
    }
  });
});

describe('PRODUCT_CATEGORY_LABELS completeness', () => {
  it('has all 3 product categories', () => {
    expect(Object.keys(PRODUCT_CATEGORY_LABELS).sort()).toEqual(
      ['digital', 'physical', 'tool'],
    );
  });
});
