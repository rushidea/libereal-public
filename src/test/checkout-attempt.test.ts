import { beforeEach, describe, expect, it } from 'vitest';
import { clearCheckoutAttempt, getOrCreateCheckoutAttempt } from '@/lib/checkout-attempt';

describe('browser checkout attempt persistence', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('reuses an opaque attempt for the same intent and rotates it when intent changes', async () => {
    const first = await getOrCreateCheckoutAttempt('order', { items: [{ productId: 'p1', quantity: 1 }], paymentMethod: 'alipay' });
    const replay = await getOrCreateCheckoutAttempt('order', { paymentMethod: 'alipay', items: [{ quantity: 1, productId: 'p1' }] });
    expect(replay).toEqual(first);
    const changed = await getOrCreateCheckoutAttempt('order', { items: [{ productId: 'p1', quantity: 2 }], paymentMethod: 'alipay' });
    expect(changed.attemptId).not.toBe(first.attemptId);
    expect(changed.intentDigest).not.toBe(first.intentDigest);
  });

  it('rotates across actors and contact changes while retaining opaque storage', async () => {
    const first = await getOrCreateCheckoutAttempt('order', { actorId: 'synthetic-one', addressText: 'Synthetic address one' });
    const actorChanged = await getOrCreateCheckoutAttempt('order', { actorId: 'synthetic-two', addressText: 'Synthetic address one' });
    const contactChanged = await getOrCreateCheckoutAttempt('order', { actorId: 'synthetic-two', addressText: 'Synthetic address two' });
    expect(actorChanged.attemptId).not.toBe(first.attemptId);
    expect(contactChanged.attemptId).not.toBe(actorChanged.attemptId);
    expect(window.sessionStorage.getItem('libereal:checkout-attempt:order')).not.toContain('Synthetic address');
  });

  it('clears a completed operation without storing personal fields', async () => {
    await getOrCreateCheckoutAttempt('inquiry', { email: 'private@example.test', items: [{ itemId: 'i1', quantity: 1 }] });
    const raw = window.sessionStorage.getItem('libereal:checkout-attempt:inquiry') || '';
    expect(raw).not.toContain('private@example.test');
    clearCheckoutAttempt('inquiry');
    expect(window.sessionStorage.getItem('libereal:checkout-attempt:inquiry')).toBeNull();
  });
});
