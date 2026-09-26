import { describe, expect, it } from 'vitest';
import {
  formatOrderPaymentMethod,
  isThirdPartyPaymentMethod,
  normalizeOrderPaymentMethod,
  ORDER_PAYMENT_METHODS,
} from '@/data/payment-methods';

describe('order payment methods', () => {
  it('exposes only the supported order payment methods', () => {
    expect(ORDER_PAYMENT_METHODS.map(method => method.value)).toEqual([
      'bank_transfer',
      'rjmart',
      'casmart',
      'alipay',
    ]);
  });

  it('normalizes legacy transfer and platform values', () => {
    expect(normalizeOrderPaymentMethod('转账汇款')).toBe('bank_transfer');
    expect(normalizeOrderPaymentMethod('transfer')).toBe('bank_transfer');
    expect(normalizeOrderPaymentMethod('corporate')).toBe('bank_transfer');
    expect(normalizeOrderPaymentMethod('kasima')).toBe('casmart');
    expect(normalizeOrderPaymentMethod('zfb')).toBe('alipay');
  });

  it('keeps historical unsupported methods readable', () => {
    expect(normalizeOrderPaymentMethod('weixin')).toBeUndefined();
    expect(formatOrderPaymentMethod('weixin')).toBe('微信支付');
    expect(formatOrderPaymentMethod('corporate')).toBe('对公转账');
  });

  it('identifies third-party platforms after normalization', () => {
    expect(isThirdPartyPaymentMethod('锐竞（第三方平台）')).toBe(true);
    expect(isThirdPartyPaymentMethod('casmart')).toBe(true);
    expect(isThirdPartyPaymentMethod('bank_transfer')).toBe(false);
  });
});
