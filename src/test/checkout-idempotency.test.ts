import { describe, expect, it } from 'vitest';
import { buildCheckoutRequestFingerprint, validCheckoutAttemptId } from '@/lib/checkout-idempotency';

describe('checkout idempotency fingerprints', () => {
  it('normalizes equivalent item and legal-id ordering', () => {
    const base = {
      items: [{ productId: 'p-1', variantId: 'v-1', quantity: 2, spec: '10 mL', unit: '瓶' }],
      acceptedLegalIds: ['b', 'a'], paymentMethod: 'bank_transfer', ignoredUiField: 'one',
    };
    const changed = {
      acceptedLegalIds: ['a', 'b'],
      items: [{ unit: '瓶', quantity: 2, spec: '10 mL', variantId: 'v-1', productId: 'p-1' }],
      paymentMethod: 'bank_transfer', ignoredUiField: 'two',
    };
    const make = (request: Record<string, unknown>) => buildCheckoutRequestFingerprint({
      operation: 'order', actorId: 'user-1', organizationId: null, ownerScope: 'personal', request,
    });
    expect(make(base)).toBe(make(changed));
  });

  it('changes when actor, scope, or meaningful quantity changes', () => {
    const input = { items: [{ productId: 'p-1', quantity: 1 }], paymentMethod: 'alipay' };
    const make = (actorId: string, organizationId: string | null, request = input) => buildCheckoutRequestFingerprint({
      operation: 'order', actorId, organizationId, ownerScope: organizationId ? 'organization' : 'personal', request,
    });
    expect(make('user-1', null)).not.toBe(make('user-2', null));
    expect(make('user-1', 'org-1')).not.toBe(make('user-1', null));
    expect(make('user-1', null, { ...input, items: [{ productId: 'p-1', quantity: 2 }] })).not.toBe(make('user-1', null));
  });

  it('accepts only bounded attempt identifiers', () => {
    expect(validCheckoutAttemptId('checkout:order:1')).toBe(true);
    expect(validCheckoutAttemptId('')).toBe(false);
    expect(validCheckoutAttemptId('a'.repeat(129))).toBe(false);
    expect(validCheckoutAttemptId('../unsafe')).toBe(false);
  });
});
