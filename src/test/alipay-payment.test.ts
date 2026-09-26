import { describe, expect, it } from 'vitest';
import { canPayOrderWithAlipay, formatAlipayTimeExpire, getAlipayPaymentExpiresAt, getAlipayPaymentSummary } from '@/data/alipay-payment';

describe('Alipay payment window', () => {
  const createdAt = new Date('2026-07-16T00:00:00.000Z');

  it('expires exactly 24 hours after order creation', () => {
    expect(getAlipayPaymentExpiresAt(createdAt).toISOString()).toBe('2026-07-17T00:00:00.000Z');
    expect(formatAlipayTimeExpire(createdAt)).toBe('2026-07-17 08:00:00');
    expect(canPayOrderWithAlipay(
      { createdAt, paymentMethod: 'alipay', paidAt: null, status: 'unpaid' },
      new Date('2026-07-16T23:59:59.999Z'),
    )).toBe(true);
    expect(canPayOrderWithAlipay(
      { createdAt, paymentMethod: 'alipay', paidAt: null, status: 'pending' },
      new Date('2026-07-16T23:59:59.999Z'),
    )).toBe(true);
    expect(canPayOrderWithAlipay(
      { createdAt, paymentMethod: 'alipay', paidAt: null, status: 'pending' },
      new Date('2026-07-17T00:00:00.000Z'),
    )).toBe(false);
  });

  it('rejects paid, cancelled, and non-Alipay orders', () => {
    const now = new Date('2026-07-16T01:00:00.000Z');
    expect(canPayOrderWithAlipay({ createdAt, paymentMethod: 'alipay', paidAt: now, status: 'pending' }, now)).toBe(false);
    expect(canPayOrderWithAlipay({ createdAt, paymentMethod: 'alipay', paidAt: null, status: 'cancelled' }, now)).toBe(false);
    expect(canPayOrderWithAlipay({ createdAt, paymentMethod: 'alipay', paidAt: null, status: 'closed' }, now)).toBe(false);
    expect(canPayOrderWithAlipay({ createdAt, paymentMethod: 'bank_transfer', paidAt: null, status: 'pending' }, now)).toBe(false);
  });

  it('accepts the legacy zfb value for unpaid orders', () => {
    expect(canPayOrderWithAlipay(
      { createdAt, paymentMethod: 'zfb', paidAt: null, status: 'unpaid' },
      new Date('2026-07-16T01:00:00.000Z'),
    )).toBe(true);
  });

  it('derives customer-visible payment states from the order and latest attempt', () => {
    const now = new Date('2026-07-16T01:00:00.000Z');
    const order = { createdAt, paymentMethod: 'alipay', paidAt: null, status: 'pending' };

    expect(getAlipayPaymentSummary(order, null, now)?.status).toBe('pending');
    expect(getAlipayPaymentSummary(order, { status: 'notified' }, now)?.status).toBe('processing');
    expect(getAlipayPaymentSummary(order, { status: 'TRADE_CLOSED' }, now)?.status).toBe('closed');
    expect(getAlipayPaymentSummary(order, { status: 'failed' }, now)?.status).toBe('failed');
    expect(getAlipayPaymentSummary(order, { status: 'paid', paidAt: now }, now)?.status).toBe('paid');
    expect(getAlipayPaymentSummary({ createdAt, paymentMethod: 'alipay', paidAt: null, status: 'closed' }, null, now)?.status).toBe('closed');
  });

  it('marks an unpaid Alipay order expired at the payment deadline', () => {
    expect(getAlipayPaymentSummary(
      { createdAt, paymentMethod: 'alipay', paidAt: null, status: 'pending' },
      { status: 'created' },
      new Date('2026-07-17T00:00:00.000Z'),
    )?.status).toBe('expired');
  });

  it('returns no payment summary for non-Alipay orders', () => {
    expect(getAlipayPaymentSummary({ createdAt, paymentMethod: 'bank_transfer' })).toBeNull();
  });
});
