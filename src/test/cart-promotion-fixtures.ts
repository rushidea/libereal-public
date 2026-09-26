import type { AddonRuleConfig, CartLine } from '@/lib/cart-promotions/types';
import type { VerifiedItem } from '@/lib/pricing';
export const sampleRuleId = 'sample-addon-rule';
export const sampleAddonRule: AddonRuleConfig = { id: sampleRuleId, type: 'addon', name: 'Synthetic add-on offer', enabled: true, description: 'Synthetic fixture only.', eligibleBrand: 'Sample', eligibleTerms: ['SAMPLE-MAIN'], minQuantity: 6, addonPrice: 50, addonBrand: 'Sample', addonTerms: ['SAMPLE-ADDON'] };
export function promotionLines(mainQuantity = 6, addonQuantity = 1): CartLine[] { return [
  { id: '0', product: { id: 'main', name: 'Sample main item', brand: 'Sample', catalogNumber: 'SAMPLE-MAIN-1', price: 100 }, quantity: mainQuantity },
  { id: '1', product: { id: 'addon', name: 'Sample add-on item', brand: 'Sample', catalogNumber: 'SAMPLE-ADDON-1', price: 300 }, quantity: addonQuantity, promoMark: { ruleId: sampleRuleId, price: 50 } },
]; }
export function verifiedPromotion(lines = promotionLines()) { const verifiedItems: VerifiedItem[] = lines.map((line) => ({ productId: line.product.id, catalogNumber: line.product.catalogNumber, brand: line.product.brand, name: line.product.name ?? '', spec: line.product.spec, quantity: line.quantity, unitPrice: line.product.price ?? 0, lineTotal: line.quantity * (line.product.price ?? 0), source: 'db', priceMismatch: false, pricingSnapshot: JSON.stringify({ finalPrice: line.product.price }) })); return { verifiedItems, verifiedSubtotal: verifiedItems.reduce((sum, item) => sum + item.lineTotal, 0), mismatchedCount: 0 }; }
export function submittedPromotion(lines = promotionLines()) { return lines.map((line) => ({ productId: line.product.id, brand: line.product.brand, catalogNumber: line.product.catalogNumber, name: line.product.name ?? '', quantity: line.quantity, price: line.product.price ?? 0, promoMark: line.promoMark })); }
