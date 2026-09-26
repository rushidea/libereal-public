import { describe, expect, it } from 'vitest';
import { getEffectiveProductPrice, getProductDisplayPrice, isFormalMemberUser, isPricedProduct } from '@/lib/product-pricing';
describe('generic product pricing helpers', () => {
 it('uses a positive promotional price when present', () => { expect(getEffectiveProductPrice({ price: 10, promotionalPrice: 8 })).toBe(8); });
 it('falls back to catalog price and then server display price', () => { expect(getEffectiveProductPrice({ price: 12, promotionalPrice: 0 })).toBe(12); expect(getEffectiveProductPrice({ displayPrice: { salePrice: 9, showGuestDiscount: false, isPromo: false, hasPrice: true } })).toBe(9); });
 it('treats missing or zero price as inquiry-only', () => { expect(isPricedProduct({ price: 0 })).toBe(false); });
 it('shows promotion price and reference price generically', () => { expect(getProductDisplayPrice({ price: 10, promotionalPrice: 8, originalPrice: 12 })).toMatchObject({ salePrice: 8, strikethroughPrice: 12, isPromo: true }); });
});
describe('formal member eligibility', () => { it('requires approval and no disqualifying status', () => { expect(isFormalMemberUser({ approvalStatus: 'approved', isNewUser: false, isFrozen: false, isBlacklisted: false })).toBe(true); expect(isFormalMemberUser({ approvalStatus: 'approved', isNewUser: true })).toBe(false); }); });
