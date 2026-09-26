import { describe, expect, it } from 'vitest';
import { promotionEngine } from '@/lib/cart-promotions/engine';
import { validateAddonPromotionLines } from '@/lib/cart-promotions/service';
import { promotionLines, sampleAddonRule } from './cart-promotion-fixtures';
describe('generic server-side add-on validation', () => {
 it('accepts eligible synthetic add-ons', () => { const lines = promotionLines(); expect(validateAddonPromotionLines(lines, promotionEngine.evaluateAll(lines, [sampleAddonRule]))).toBeNull(); });
 it('rejects when threshold is not met', () => { const lines = promotionLines(5); expect(validateAddonPromotionLines(lines, promotionEngine.evaluateAll(lines, [sampleAddonRule]))).toBe('ADDON_NOT_TRIGGERED'); });
 it('rejects an unknown rule or a tampered price', () => { const lines = promotionLines(); const evals = promotionEngine.evaluateAll(lines, [sampleAddonRule]); lines[1].promoMark = { ruleId: 'unknown', price: 50 }; expect(validateAddonPromotionLines(lines, evals)).toBe('PROMOTION_NOT_FOUND'); });
});
