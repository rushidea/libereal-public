import { describe, expect, it } from 'vitest';
import { requiresWrittenSupplierQuote } from '@/lib/supplier-quote-policy';
import { parsePriceAdjustmentRequest } from '@/lib/pricing-adjustment-rules';
import { priceAdjustmentApprovalHash } from '@/lib/pricing-adjustment-approval';

describe('a brand supplier enquiry boundary', () => {
  it('uses a strict per-package threshold and never infers a missing catalogue price is small', () => {
    expect(requiresWrittenSupplierQuote(499.99, 500)).toBe(false);
    expect(requiresWrittenSupplierQuote(500, 500)).toBe(false);
    expect(requiresWrittenSupplierQuote(500.01, 500)).toBe(true);
    for (const price of [undefined, null, 0, -1, NaN, Infinity]) expect(requiresWrittenSupplierQuote(price, 500)).toBe(true);
    expect(requiresWrittenSupplierQuote(900, null)).toBe(false);
    expect(requiresWrittenSupplierQuote(900, undefined)).toBe(false);
    for (const policy of [0, -1, NaN, Infinity]) expect(() => requiresWrittenSupplierQuote(499, policy)).toThrow('INVALID_SUPPLIER_QUOTE_POLICY');
  });
  it('distinguishes keeping an existing rule from explicitly removing it', () => {
    const base = { target: 'brand_default_discount', brand: 'Fixture', brandDefaultDiscountRate: 0.8, reason: 'Confirmed fixture policy' };
    const keep = parsePriceAdjustmentRequest(base);
    const clear = parsePriceAdjustmentRequest({ ...base, supplierQuoteRequiredAbove: null });
    const set = parsePriceAdjustmentRequest({ ...base, supplierQuoteRequiredAbove: 500 });
    expect(keep.ok && Object.hasOwn(keep.value, 'supplierQuoteRequiredAbove')).toBe(false);
    expect(clear).toMatchObject({ ok: true, value: { supplierQuoteRequiredAbove: null } });
    expect(set).toMatchObject({ ok: true, value: { supplierQuoteRequiredAbove: 500 } });
    for (const value of ['', '500', false, -1, 0, 500.001, NaN, Infinity]) {
      expect(parsePriceAdjustmentRequest({ ...base, supplierQuoteRequiredAbove: value }).ok).toBe(false);
    }
    if (!keep.ok || !clear.ok || !set.ok) throw new Error('Fixture request invalid');
    const hashes = [keep.value, clear.value, set.value].map(request => priceAdjustmentApprovalHash(request, { scope: 'fixture' }));
    expect(new Set(hashes).size).toBe(3);
  });
});
