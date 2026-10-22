import { describe, expect, it } from 'vitest';
import {
  QUOTE_ACCEPTANCE_RULES,
  lineTotalForAcceptedQuantity,
  mergeQuoteConstraintMetadata,
  packageConstraintFromVariant,
  quoteLineFulfillment,
  validateAcceptedQuantity,
} from '@/lib/quote-acceptance';
import { quoteAcceptancePointsAudit } from '@/lib/quote-acceptance-guards';

describe('quote acceptance quantity rules', () => {
  it('reuses the quoted unit price and allows quantities above the quote', () => {
    expect(QUOTE_ACCEPTANCE_RULES.exceedQuotedQuantity).toBe(true);
    expect(QUOTE_ACCEPTANCE_RULES.orderedQtyCappedAtQuotedQuantity).toBe(true);
    expect(QUOTE_ACCEPTANCE_RULES.unitPrice).toBe('quoted-unit-price');
    expect(QUOTE_ACCEPTANCE_RULES.pointsRedeemedAtAcceptance).toBe(false);
    expect(validateAcceptedQuantity({ quotedQuantity: 2, orderedQty: 0, requested: 1 })).toEqual({ ok: true, quantity: 1 });
    expect(validateAcceptedQuantity({ quotedQuantity: 2, orderedQty: 0, requested: 5 })).toEqual({ ok: true, quantity: 5 });
    expect(lineTotalForAcceptedQuantity(150, 5)).toBe(750);
  });

  it('caps quote-line ordered quantity at the quoted quantity when the order exceeds it', () => {
    expect(quoteLineFulfillment({ quotedQuantity: 2, orderedQty: 0, acceptedQuantity: 5 })).toEqual({
      orderedQty: 2,
      remaining: 0,
      fulfilled: true,
    });
    expect(quoteLineFulfillment({ quotedQuantity: 10, orderedQty: 4, acceptedQuantity: 3 })).toEqual({
      orderedQty: 7,
      remaining: 3,
      fulfilled: false,
    });
    expect(quoteLineFulfillment({ quotedQuantity: 10, orderedQty: 4, acceptedQuantity: 20 })).toEqual({
      orderedQty: 10,
      remaining: 0,
      fulfilled: true,
    });
  });

  it('rejects non-integers, zero, and values below a compatible MOQ or package step', () => {
    expect(validateAcceptedQuantity({ quotedQuantity: 4, orderedQty: 0, requested: 0 }).ok).toBe(false);
    expect(validateAcceptedQuantity({ quotedQuantity: 4, orderedQty: 0, requested: 1.5 }).ok).toBe(false);
    const metadata = JSON.stringify({ minQuantity: 2, quantityStep: 2 });
    expect(validateAcceptedQuantity({ quotedQuantity: 4, orderedQty: 0, requested: 1, metadata })).toMatchObject({ ok: false, code: 'BELOW_MINIMUM' });
    expect(validateAcceptedQuantity({ quotedQuantity: 4, orderedQty: 0, requested: 3, metadata })).toMatchObject({ ok: false, code: 'NOT_PACKAGE_MULTIPLE' });
    expect(validateAcceptedQuantity({ quotedQuantity: 4, orderedQty: 0, requested: 2, metadata })).toEqual({ ok: true, quantity: 2 });
    expect(validateAcceptedQuantity({ quotedQuantity: 4, orderedQty: 0, requested: 6, metadata })).toEqual({ ok: true, quantity: 6 });
    expect(validateAcceptedQuantity({ quotedQuantity: 4, orderedQty: 0, requested: 5, metadata })).toMatchObject({ ok: false, code: 'NOT_PACKAGE_MULTIPLE' });
  });

  it('ignores package constraints the quoted quantity itself does not satisfy', () => {
    const metadata = mergeQuoteConstraintMetadata('{"variantId":"v1"}', { minQuantity: 6, quantityStep: 6 }, 2);
    expect(metadata).toBe('{"variantId":"v1"}');
    expect(validateAcceptedQuantity({ quotedQuantity: 2, orderedQty: 0, requested: 1, metadata: '{"minQuantity":6,"quantityStep":6}' })).toEqual({ ok: true, quantity: 1 });
  });

  it('snapshots a package multiple only when the variant is sold as a package', () => {
    expect(packageConstraintFromVariant({ packageType: 'case', baseQuantity: 6 })).toEqual({ minQuantity: 6, quantityStep: 6 });
    expect(packageConstraintFromVariant({ packageType: null, baseQuantity: 6 })).toEqual({ minQuantity: null, quantityStep: null });
  });

  it('bases earnable points on the accepted amount', () => {
    expect(quoteAcceptancePointsAudit(1000).earnablePoints).toBe(1);
    expect(quoteAcceptancePointsAudit(2000).earnablePoints).toBe(2);
    expect(quoteAcceptancePointsAudit(1000).pointsRedeemed).toBe(0);
  });
});
