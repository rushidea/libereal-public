import { describe, expect, it } from 'vitest';
import {
  adminOrderMoneyMessage,
  adminOrderQuantityMessage,
  adminOrderResolvedLineError,
  parseAdminOrderCreateCharges,
  parseNonNegativeMoney,
  parsePositiveInteger,
} from '@/lib/admin-order-create';

describe('admin order money and quantity parsing', () => {
  it('accepts finite non-negative amounts with at most two decimal places', () => {
    for (const value of [0, 0.01, 10, 10.5, 10.55, 8.23, '0', '10.50', ' 18 ', 1e2]) {
      expect(parseNonNegativeMoney(value)).not.toBeNull();
    }
    expect(parseNonNegativeMoney('10.50')).toBe(10.5);
    expect(parseNonNegativeMoney(8.23)).toBe(8.23);
    expect(parseNonNegativeMoney(0)).toBe(0);
  });

  it('rejects invalid money', () => {
    for (const value of [
      -1,
      -0.01,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1.234,
      10.555,
      '10.555',
      '10.',
      '-1',
      '1e2',
      'abc',
      '12元',
      '',
      '  ',
      null,
      true,
      false,
      {},
      [],
    ]) {
      expect(parseNonNegativeMoney(value)).toBeNull();
    }
  });

  it('accepts positive integers and rejects everything else', () => {
    expect(parsePositiveInteger(1)).toBe(1);
    expect(parsePositiveInteger(2.0)).toBe(2);
    expect(parsePositiveInteger('3')).toBe(3);
    expect(parsePositiveInteger(' 12 ')).toBe(12);
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '0', '1.5', '01', '', null, true, 1.2]) {
      expect(parsePositiveInteger(value)).toBeNull();
    }
  });

  it('defaults omitted fees to zero and normalizes line price and quantity', () => {
    const parsed = parseAdminOrderCreateCharges({
      items: [
        { name: '抗体A', price: '100.50', quantity: '2' },
        { name: '耗材B', quantity: 1 },
      ],
      platformFee: undefined,
      transferFee: '0.20',
    });
    expect(parsed).toEqual({
      ok: true,
      platformFee: 0,
      transferFee: 0.2,
      lines: [{ price: 100.5, quantity: 2 }, { quantity: 1 }],
    });
  });

  it('returns a Chinese error for an illegal fee, unit price, or quantity', () => {
    expect(parseAdminOrderCreateCharges({
      items: [{ name: '抗体A', price: 10, quantity: 1 }],
      platformFee: -2,
      transferFee: 0,
    })).toEqual({ ok: false, error: adminOrderMoneyMessage('平台服务费') });

    expect(parseAdminOrderCreateCharges({
      items: [{ name: '抗体A', price: 10, quantity: 1 }],
      platformFee: 1,
      transferFee: 1.234,
    })).toEqual({ ok: false, error: adminOrderMoneyMessage('转账手续费') });

    expect(parseAdminOrderCreateCharges({
      items: [{ name: '抗体A', price: Number.NaN, quantity: 1 }],
      platformFee: 0,
      transferFee: 0,
    })).toEqual({ ok: false, error: adminOrderMoneyMessage('第 1 行「抗体A」单价') });

    expect(parseAdminOrderCreateCharges({
      items: [{ price: 10, quantity: 0 }, { name: '第二件', price: -1, quantity: 1 }],
      platformFee: 0,
      transferFee: 0,
    })).toEqual({ ok: false, error: adminOrderQuantityMessage('第 1 行') });

    expect(parseAdminOrderCreateCharges({
      items: [null],
      platformFee: 0,
      transferFee: 0,
    })).toEqual({ ok: false, error: '第 1 行商品格式不正确' });
  });

  it('reads unitPrice when price is omitted and still allows a zero unit price', () => {
    expect(parseAdminOrderCreateCharges({
      items: [{ name: '赠品', unitPrice: 0, quantity: 1 }],
      platformFee: undefined,
      transferFee: undefined,
    })).toEqual({
      ok: true,
      platformFee: 0,
      transferFee: 0,
      lines: [{ price: 0, quantity: 1 }],
    });
  });

  it('checks the priced line with the same hard rules', () => {
    expect(adminOrderResolvedLineError(0, '抗体A', 10.5, 2)).toBeNull();
    expect(adminOrderResolvedLineError(1, '抗体A', -1, 2)).toBe(adminOrderMoneyMessage('第 2 行「抗体A」单价'));
    expect(adminOrderResolvedLineError(0, null, 10, 1.5)).toBe(adminOrderQuantityMessage('第 1 行'));
  });
});
