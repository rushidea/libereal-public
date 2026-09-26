import type { AddonRuleConfig, CartLine, GiftRuleConfig } from './types';

type ProductIdentity = Pick<CartLine['product'], 'brand' | 'catalogNumber' | 'name'>;

export function isEligibleMainProduct(rule: AddonRuleConfig, product: ProductIdentity): boolean {
  return product.brand === rule.eligibleBrand
    && (rule.eligibleTerms.some((term) => product.catalogNumber.startsWith(term))
      || Boolean(rule.eligibleNameIncludes?.length && rule.eligibleNameIncludes.every((term) => product.name?.toLowerCase().includes(term.toLowerCase()))));
}

export function isAddonProduct(rule: AddonRuleConfig, product: ProductIdentity): boolean {
  return (!rule.addonBrand || product.brand === rule.addonBrand)
    && rule.addonTerms.some((term) => product.catalogNumber.startsWith(term));
}

export function isGiftProduct(rule: GiftRuleConfig, product: ProductIdentity): boolean {
  return (!rule.giftBrand || product.brand === rule.giftBrand)
    && rule.giftTerms.some((term) => product.catalogNumber.startsWith(term));
}
