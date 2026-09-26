import type { RuleConfig } from './cart-promotions/types';
import { getRuleLifecycle, type PromotionLifecycle } from './cart-promotions/lifecycle';
import { isAddonProduct, isEligibleMainProduct } from './cart-promotions/matching';

export type PromotionSkuRecord = {
  productId: string;
  variantId: string | null;
  brand: string;
  catalogNumber: string;
  name: string;
  spec: string | null;
};

export type PromotionMigrationGroup = {
  key: string;
  role: 'qualifier' | 'benefit' | 'qualifier-and-benefit';
  skus: PromotionSkuRecord[];
};

export type PromotionMigrationRuleAudit = {
  id: string;
  name: string;
  type: RuleConfig['type'];
  lifecycle: PromotionLifecycle;
  groups: Array<{ key: string; role: PromotionMigrationGroup['role']; skuCount: number }>;
  blockers: string[];
};

export type PromotionMigrationOverlap = {
  firstRuleId: string;
  secondRuleId: string;
  skuCount: number;
  examples: string[];
};

export type PromotionMigrationAudit = {
  generatedAt: string;
  skuCount: number;
  rules: PromotionMigrationRuleAudit[];
  overlaps: PromotionMigrationOverlap[];
};

function startsWithAny(value: string, terms: readonly string[] | undefined): boolean {
  return Boolean(terms?.some((term) => value.startsWith(term)));
}

function sameBrand(actual: string, expected: string | undefined): boolean {
  return !expected || actual === expected;
}

function normalizedSpec(value: string): string {
  return value.toLowerCase().replace(/\s/g, '');
}

function fixedPriceForSku(rule: Extract<RuleConfig, { type: 'fixed-price' }>, sku: PromotionSkuRecord): number | null {
  const spec = normalizedSpec(sku.spec ?? sku.catalogNumber);
  const exact = rule.priceBySpec?.find((entry) => entry.term === sku.catalogNumber && normalizedSpec(entry.spec) === spec);
  if (exact) return exact.price;
  const bySpec = rule.priceBySpec?.find((entry) => !entry.term && normalizedSpec(entry.spec) === spec);
  if (bySpec) return bySpec.price;
  const byTerm = rule.priceByTerm?.find((entry) => sku.catalogNumber.startsWith(entry.term));
  if (byTerm) return byTerm.price;
  const loose = rule.priceBySpec?.find((entry) => !entry.term
    && (spec.includes(normalizedSpec(entry.spec)) || normalizedSpec(entry.spec).includes(spec)));
  return loose?.price ?? null;
}

function group(key: string, role: PromotionMigrationGroup['role'], skus: PromotionSkuRecord[], match: (sku: PromotionSkuRecord) => boolean): PromotionMigrationGroup {
  return { key, role, skus: skus.filter(match) };
}

export function resolveLegacyPromotionGroups(rule: RuleConfig, skus: PromotionSkuRecord[]): { groups: PromotionMigrationGroup[]; blockers: string[] } {
  const blockers: string[] = [];
  if (rule.type === 'coupon') return { groups: [], blockers: ['优惠券不使用商品规格绑定'] };
  if (rule.type === 'addon') return { groups: [
    group('main', 'qualifier', skus, (sku) => isEligibleMainProduct(rule, sku)),
    group('benefit', 'benefit', skus, (sku) => isAddonProduct(rule, sku)),
  ], blockers };
  if (rule.type === 'gift') {
    if (rule.specGifts?.length) blockers.push('不同规格使用不同门槛或赠品数量');
    if (rule.sameProduct) return { groups: [
      group('same', 'qualifier-and-benefit', skus, (sku) => sameBrand(sku.brand, rule.eligibleBrand)
        && (!rule.eligibleTerms?.length || startsWithAny(sku.catalogNumber, rule.eligibleTerms))),
    ], blockers };
    return { groups: [
      group('main', 'qualifier', skus, (sku) => sameBrand(sku.brand, rule.eligibleBrand)
        && (!rule.eligibleTerms?.length || startsWithAny(sku.catalogNumber, rule.eligibleTerms))),
      group('benefit', 'benefit', skus, (sku) => sameBrand(sku.brand, rule.giftBrand) && startsWithAny(sku.catalogNumber, rule.giftTerms)),
    ], blockers };
  }
  if (rule.type === 'bundle') return { groups: rule.items.map((item, index) =>
    group(`group-${index + 1}`, 'qualifier-and-benefit', skus,
      (sku) => sameBrand(sku.brand, item.brand) && startsWithAny(sku.catalogNumber, item.terms))), blockers };
  if (rule.type === 'buy-n-get-m') return { groups: [
    group('same', 'qualifier-and-benefit', skus, (sku) => sameBrand(sku.brand, rule.brand) && startsWithAny(sku.catalogNumber, rule.terms)),
  ], blockers };
  if (rule.type === 'stack-discount') return { groups: [
    group('benefit', 'benefit', skus, (sku) => sameBrand(sku.brand, rule.brand) && startsWithAny(sku.catalogNumber, rule.terms)),
  ], blockers };

  const priced = skus.filter((sku) => sameBrand(sku.brand, rule.brand)
    && (rule.exactTerms?.includes(sku.catalogNumber) || startsWithAny(sku.catalogNumber, rule.terms)))
    .filter((sku) => fixedPriceForSku(rule, sku) !== null);
  const prices = new Set(priced.map((sku) => fixedPriceForSku(rule, sku)));
  if (prices.size > 1) blockers.push('同一活动包含多个规格活动价');
  return { groups: [{ key: 'benefit', role: 'benefit', skus: priced }], blockers };
}

function skuKey(sku: PromotionSkuRecord): string {
  return JSON.stringify([sku.productId, sku.variantId]);
}

export function auditLegacyPromotionBindings(rules: RuleConfig[], skus: PromotionSkuRecord[], now = new Date()): PromotionMigrationAudit {
  const owners = new Map<string, Map<string, PromotionSkuRecord>>();
  const audits = rules.map((rule) => {
    const lifecycle = getRuleLifecycle(rule, now);
    const resolved = resolveLegacyPromotionGroups(rule, skus);
    const blockers = [...resolved.blockers];
    resolved.groups.filter((entry) => entry.skus.length === 0).forEach((entry) => blockers.push(`商品组 ${entry.key} 没有匹配规格`));
    if (lifecycle === 'active') {
      for (const resolvedGroup of resolved.groups) {
        for (const sku of resolvedGroup.skus) {
          const key = skuKey(sku);
          const byRule = owners.get(key) ?? new Map<string, PromotionSkuRecord>();
          byRule.set(rule.id, sku);
          owners.set(key, byRule);
        }
      }
    }
    return { id: rule.id, name: rule.name, type: rule.type, lifecycle,
      groups: resolved.groups.map(({ key, role, skus: matched }) => ({ key, role, skuCount: matched.length })), blockers };
  });
  const pairs = new Map<string, { firstRuleId: string; secondRuleId: string; skuCount: number; examples: Set<string> }>();
  for (const byRule of owners.values()) {
    const entries = [...byRule.entries()].sort(([left], [right]) => left.localeCompare(right));
    for (let left = 0; left < entries.length; left += 1) {
      for (let right = left + 1; right < entries.length; right += 1) {
        const [firstRuleId, sku] = entries[left];
        const secondRuleId = entries[right][0];
        const key = JSON.stringify([firstRuleId, secondRuleId]);
        const pair = pairs.get(key) ?? { firstRuleId, secondRuleId, skuCount: 0, examples: new Set<string>() };
        pair.skuCount += 1;
        if (pair.examples.size < 3) pair.examples.add(sku.catalogNumber);
        pairs.set(key, pair);
      }
    }
  }
  return { generatedAt: now.toISOString(), skuCount: skus.length, rules: audits,
    overlaps: [...pairs.values()].map((pair) => ({ ...pair, examples: [...pair.examples] }))
      .sort((left, right) => right.skuCount - left.skuCount || left.firstRuleId.localeCompare(right.firstRuleId)),
  };
}
