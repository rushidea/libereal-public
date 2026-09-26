import { describe, it, expect, vi } from 'vitest';
import { computePromoAdjustments } from '@/lib/cart-promotions/service';
import type { CartLine } from '@/lib/cart-promotions/types';
import { promotionLines } from './cart-promotion-fixtures';
const rules = vi.hoisted(() => ({ sample: { id: 'sample-addon-rule', type: 'addon' as const, name: 'Synthetic add-on offer', enabled: true, description: 'Synthetic fixture only.', eligibleBrand: 'Sample', eligibleTerms: ['SAMPLE-MAIN'], minQuantity: 6, addonPrice: 50, addonBrand: 'Sample', addonTerms: ['SAMPLE-ADDON'] } }));
vi.mock('@/lib/cart-promotions/rules', () => ({ PROMOTION_RULES: [rules.sample], CART_ADDON_RULES: [rules.sample], CART_GIFT_RULES: [], CART_BUNDLE_RULES: [] }));
describe('generic cart promotion engine', () => {
 it('applies an eligible synthetic add-on offer', () => { const result = computePromoAdjustments(promotionLines()); expect(result.issues).toEqual([]); expect(result.discountTotal).toBe(250); });
 it.each([[5, 1, 0], [6, 1, 250], [12, 2, 500]])('calculates quota for %s qualifying items', (mainQty, addonQty, discount) => { const result = computePromoAdjustments(promotionLines(mainQty, addonQty)); expect(result.discountTotal).toBe(discount); });
 it('keeps over-quota add-ons at their original price', () => { const lines = promotionLines(6, 2); const result = computePromoAdjustments(lines); expect(result.discountTotal).toBe(250); expect(result.issues).toEqual([]); });
 it('does not change inputs while calculating adjustments', () => { const lines: CartLine[] = promotionLines(); const before = structuredClone(lines); computePromoAdjustments(lines); expect(lines).toEqual(before); });
});
