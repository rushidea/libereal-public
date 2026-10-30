/**
 * 购物车促销服务端辅助（下单 API / 定价预览 API 共用）。
 *
 * 统一入口：给定购物车行（CartLine[]，含 promoMark），
 * 评估全部活动 → 校验用评估结果 + 生成订单级负调整 + 汇总优惠总额。
 * 保证 /api/orders 与 /api/orders/pricing-preview 的优惠计算、平台费基准一致。
 */
import { PROMOTION_RULES } from './rules';
import { promotionEngine } from './engine';
import type { AddonRuleConfig, CartLine, GiftRuleConfig, RuleConfig, RuleEvaluation } from './types';
import type { PriceLookupItem, VerifiedItem } from '@/lib/pricing';
import { isAddonProduct, isGiftProduct } from './matching';
import { isEligibleMainProduct } from './detect';
import { assignAutomaticPromotions } from './automatic';
import { buyNGetMMainLines, getBuyNGetMFreeQuantities } from './strategies/buy-n-get-m';
import { promotionSkuKey } from '@/data/promotion-foundation';
import type { QualifiedPlanCandidate } from '@/lib/promotion-plan-solver';
import { lookupFixedPrice } from './strategies/fixed-price';

export type UnifiedLegacySourceLine = CartLine & { productId: string; variantId: string | null; unitPriceCents: number | null;
  legacyOverrides?: Record<string, number> };
export type UnifiedLegacyRuleEvidence = { id: string; name: string; type: RuleConfig['type']; canonicalConfig: string; exclusive: boolean; stackable: boolean };

function moneyCents(value: number): number {
  const cents = Math.round((value + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('INVALID_PROMOTION_AMOUNT');
  return cents;
}

function allocateUnitBands(quantity: number, totalCents: number, source: 'ordinary' | 'promotion', sourceLineId?: string) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error('INVALID_PROMOTION_AMOUNT');
  const unit = Math.floor(totalCents / quantity); const remainder = totalCents % quantity;
  return [
    ...(remainder ? [{ unitCents: unit + 1, quantity: remainder, source, ...(sourceLineId ? { sourceLineId } : {}) }] : []),
    ...(quantity > remainder ? [{ unitCents: unit, quantity: quantity - remainder, source, ...(sourceLineId ? { sourceLineId } : {}) }] : []),
  ];
}

function legacyRuleId(rule: RuleConfig): string { return `legacy-cart:${rule.id}`; }

/** Add unqualified source rows as ordinary-price bands while claiming the full SKU. */
function remainingStaticSkuRows(input: UnifiedLegacySourceLine[], key: string, included: UnifiedLegacySourceLine[]): UnifiedLegacySourceLine[] {
  const all = input.filter((line) => promotionSkuKey(line) === key);
  if (new Set(all.map((line) => line.id)).size !== all.length || all.some((line) => !line.id)) throw new Error('INVALID_PROMOTION_CANDIDATE');
  const rest = all.filter((line) => !included.includes(line));
  for (const line of rest) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.unitPriceCents === null) throw new Error('PROMOTION_PRICE_COVERAGE_REQUIRED');
    if (!Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents <= 0) throw new Error('INVALID_PROMOTION_AMOUNT');
  }
  return rest;
}

export function canonicalLegacyRule(rule: RuleConfig): string {
  const canonical = JSON.stringify(rule, (_key, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  });
  return canonical;
}

/** Enumerate complete SKU subsets for an individual legacy stack-discount rule.
 * The rule discounts the already verified member/brand price, with the legacy
 * per-source-row rounding. A SKU is claimed in full, preventing another
 * promotion from using any of its units. Exhaustion fails, never truncates.
 */
export function enumerateLegacyStackCandidates(lines: UnifiedLegacySourceLine[], rule: Extract<RuleConfig, { type: 'stack-discount' }>, maxWork = 100000): QualifiedPlanCandidate[] {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) throw new Error('INVALID_PROMOTION_ENUMERATION');
  if (!(rule.discountRate > 0 && rule.discountRate < 1)) return [];
  const bySku = new Map<string, UnifiedLegacySourceLine[]>();
  for (const line of lines) {
    if (line.isQuickOrder || line.promoMark || (rule.brand && line.product.brand !== rule.brand)
      || !rule.terms.some((term) => line.product.catalogNumber.startsWith(term))) continue;
    if (!line.id || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error('INVALID_PROMOTION_CANDIDATE');
    if (line.unitPriceCents === null) continue;
    if (line.product.price == null || moneyCents(line.product.price) !== line.unitPriceCents) throw new Error('PROMOTION_SKU_PRICE_MISMATCH');
    if (!Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents <= 0) throw new Error('INVALID_PROMOTION_AMOUNT');
    const key = promotionSkuKey(line); const group = bySku.get(key) ?? [];
    group.push(line); bySku.set(key, group);
  }
  if (bySku.size > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  const skus = [...bySku.entries()].sort(([a], [b]) => a.localeCompare(b));
  const options: QualifiedPlanCandidate['lines'] = [];
  for (const [key, rows] of skus) {
    let quantity = 0; let total = 0; let discountTotal = 0;
    const bands: NonNullable<QualifiedPlanCandidate['lines'][number]['priceBands']> = [];
    for (const row of rows) {
      const base = row.unitPriceCents! * row.quantity;
      const discount = Math.round((row.product.price ?? 0) * (1 - rule.discountRate) * row.quantity * 100);
      if (!Number.isSafeInteger(base) || !Number.isSafeInteger(discount) || discount < 0 || discount > base) throw new Error('INVALID_PROMOTION_AMOUNT');
      quantity += row.quantity; total += base - discount; discountTotal += discount;
      bands.push(...allocateUnitBands(row.quantity, base - discount, discount ? 'promotion' : 'ordinary', row.id));
    }
    for (const row of remainingStaticSkuRows(lines, key, rows)) {
      quantity += row.quantity; total += row.unitPriceCents! * row.quantity;
      bands.push({ unitCents: row.unitPriceCents!, quantity: row.quantity, source: 'ordinary', sourceLineId: row.id });
    }
    if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(total)) throw new Error('INVALID_PROMOTION_AMOUNT');
    if (discountTotal) options.push({ productId: rows[0].productId, variantId: rows[0].variantId, quantity, totalAfterCents: total, priceBands: bands });
  }
  const candidates: QualifiedPlanCandidate[] = []; let work = 0;
  const selected: QualifiedPlanCandidate['lines'] = [];
  const visit = (index: number) => {
    if (++work > maxWork) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    if (index === options.length) {
      if (selected.length) {
        const claims = selected.map((line) => ({ ...line, priceBands: line.priceBands?.map((band) => ({ ...band })) }));
        const allocationId = JSON.stringify(claims);
        candidates.push({ promotionId: legacyRuleId(rule), allocationId, qualified: true, lines: claims });
        if (candidates.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
      }
      return;
    }
    visit(index + 1); selected.push(options[index]); visit(index + 1); selected.pop();
  };
  visit(0); return candidates;
}

/** Preserve fixed-price lookup precedence and legacy per-source-row rounding. */
export function enumerateLegacyFixedCandidates(lines: UnifiedLegacySourceLine[], rule: Extract<RuleConfig, { type: 'fixed-price' }>, maxWork = 100000): QualifiedPlanCandidate[] {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) throw new Error('INVALID_PROMOTION_ENUMERATION');
  const groups = new Map<string, UnifiedLegacySourceLine[]>();
  for (const line of lines) {
    if (line.isQuickOrder || line.promoMark || (rule.brand && rule.brand !== line.product.brand)
      || !((rule.exactTerms?.includes(line.product.catalogNumber) ?? false) || rule.terms.some((term) => line.product.catalogNumber.startsWith(term)))) continue;
    const price = lookupFixedPrice(rule, line);
    if (price == null || price <= 0 || line.unitPriceCents === null || line.product.price == null || price >= line.product.price) continue;
    if (!line.id || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || !Number.isSafeInteger(line.unitPriceCents)
      || line.unitPriceCents <= 0 || moneyCents(line.product.price) !== line.unitPriceCents) throw new Error('PROMOTION_SKU_PRICE_MISMATCH');
    const key = promotionSkuKey(line); const rows = groups.get(key) ?? [];
    rows.push(line); groups.set(key, rows);
  }
  if (groups.size > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  const options: QualifiedPlanCandidate['lines'] = [];
  for (const [key, rows] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    let quantity = 0; let total = 0; const bands: NonNullable<QualifiedPlanCandidate['lines'][number]['priceBands']> = [];
    for (const row of rows) {
      const fixed = lookupFixedPrice(rule, row)!;
      const original = row.unitPriceCents! * row.quantity;
      const discount = Math.round((row.product.price! - fixed) * row.quantity * 100);
      if (!Number.isSafeInteger(original) || !Number.isSafeInteger(discount) || discount < 0 || discount > original) throw new Error('INVALID_PROMOTION_AMOUNT');
      quantity += row.quantity; total += original - discount;
      bands.push(...allocateUnitBands(row.quantity, original - discount, discount ? 'promotion' : 'ordinary', row.id));
    }
    for (const row of remainingStaticSkuRows(lines, key, rows)) {
      quantity += row.quantity; total += row.unitPriceCents! * row.quantity;
      bands.push({ unitCents: row.unitPriceCents!, quantity: row.quantity, source: 'ordinary', sourceLineId: row.id });
    }
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(quantity)) throw new Error('INVALID_PROMOTION_AMOUNT');
    options.push({ productId: rows[0].productId, variantId: rows[0].variantId, quantity, totalAfterCents: total, priceBands: bands });
  }
  const candidates: QualifiedPlanCandidate[] = []; const selected: QualifiedPlanCandidate['lines'] = []; let work = 0;
  const visit = (index: number) => {
    if (++work > maxWork) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    if (index === options.length) {
      if (selected.length) {
        const claims = selected.map((line) => ({ ...line, priceBands: line.priceBands?.map((band) => ({ ...band })) }));
        candidates.push({ promotionId: legacyRuleId(rule), allocationId: JSON.stringify(claims), qualified: true, lines: claims });
        if (candidates.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
      }
      return;
    }
    visit(index + 1); selected.push(options[index]); visit(index + 1); selected.pop();
  };
  visit(0); return candidates;
}

/** Enumerate legacy buy-N alternatives before selecting any other promotion.
 * Preserve the historical positions groupSize, 2*groupSize, ... even when
 * freeCount is greater than one; changing that would rewrite existing rules.
 */
export function enumerateLegacyBuyNCandidates(lines: UnifiedLegacySourceLine[], rule: Extract<RuleConfig, { type: 'buy-n-get-m' }>, maxWork = 100000): QualifiedPlanCandidate[] {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) throw new Error('INVALID_PROMOTION_ENUMERATION');
  const eligible = buyNGetMMainLines(lines, rule) as UnifiedLegacySourceLine[];
  const bySku = new Map<string, UnifiedLegacySourceLine[]>();
  let quantity = 0;
  for (const line of eligible) {
    if (!line.id || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error('INVALID_PROMOTION_CANDIDATE');
    if (line.unitPriceCents === null) continue;
    if (!Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents <= 0 || line.product.price == null
      || moneyCents(line.product.price) !== line.unitPriceCents) throw new Error('PROMOTION_SKU_PRICE_MISMATCH');
    quantity += line.quantity;
    if (!Number.isSafeInteger(quantity) || quantity > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    const key = promotionSkuKey(line); const group = bySku.get(key) ?? [];
    group.push(line); bySku.set(key, group);
  }
  if (bySku.size > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  const keys = [...bySku.keys()].sort(); const selected = new Set<string>();
  const candidates: QualifiedPlanCandidate[] = []; let work = 0;
  const visit = (index: number) => {
    if (++work > maxWork) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    if (index < keys.length) {
      visit(index + 1); selected.add(keys[index]); visit(index + 1); selected.delete(keys[index]); return;
    }
    if (!selected.size) return;
    // Preserve original row ordering for equal-price units.
    const subset = eligible.filter((line) => selected.has(promotionSkuKey(line)) && line.unitPriceCents !== null);
    work += subset.reduce((sum, line) => sum + line.quantity, 0);
    if (work > maxWork) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    const free = getBuyNGetMFreeQuantities(subset, rule);
    if (![...free.values()].some((value) => value > 0)) return;
    const claims: QualifiedPlanCandidate['lines'] = [];
    for (const key of keys.filter((item) => selected.has(item))) {
      const rows = bySku.get(key)!; const first = rows[0]; let total = 0; let count = 0; let freeCount = 0;
      const bands: NonNullable<QualifiedPlanCandidate['lines'][number]['priceBands']> = [];
      for (const row of rows) {
        const n = free.get(row) ?? 0; freeCount += n; count += row.quantity;
        const ordinary = row.quantity - n; total += ordinary * row.unitPriceCents!;
        if (ordinary) bands.push({ unitCents: row.unitPriceCents!, quantity: ordinary, source: 'ordinary', sourceLineId: row.id });
        if (n) bands.push({ unitCents: 0, quantity: n, source: 'promotion', sourceLineId: row.id });
      }
      for (const row of remainingStaticSkuRows(lines, key, rows)) {
        count += row.quantity; total += row.unitPriceCents! * row.quantity;
        bands.push({ unitCents: row.unitPriceCents!, quantity: row.quantity, source: 'ordinary', sourceLineId: row.id });
      }
      if (!Number.isSafeInteger(total) || !Number.isSafeInteger(count)) throw new Error('INVALID_PROMOTION_AMOUNT');
      claims.push({ productId: first.productId, variantId: first.variantId, quantity: count, totalAfterCents: total,
        ...(freeCount ? { role: 'benefit' as const, priceBands: bands } : { role: 'qualifier' as const, priceBands: bands }) });
    }
    const allocationId = JSON.stringify(claims);
    candidates.push({ promotionId: legacyRuleId(rule), allocationId, qualified: true, lines: claims });
    if (candidates.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  };
  visit(0); return candidates;
}

/** Legacy bundle: enumerate SKU subsets and compute the configured discount
 * directly from each qualified subset. Groups count independently, matching the
 * original strategy, while each source row enters the subtotal only once.
 */
export function enumerateLegacyBundleCandidates(lines: UnifiedLegacySourceLine[], rule: Extract<RuleConfig, { type: 'bundle' }>, maxWork = 100000): QualifiedPlanCandidate[] {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) throw new Error('INVALID_PROMOTION_ENUMERATION');
  if (!rule.items.length || rule.items.some((group) => !Number.isSafeInteger(group.quantity) || group.quantity <= 0)
    || !Number.isFinite(rule.discountValue) || rule.discountValue < 0
    || (rule.discountKind === 'percent' && rule.discountValue > 1)) throw new Error('UNIFIED_STATIC_RULE_INVALID');
  const matches = (line: UnifiedLegacySourceLine, group: typeof rule.items[number]) => !line.isQuickOrder && !line.promoMark
    && (!group.brand || group.brand === line.product.brand) && group.terms.some((term) => line.product.catalogNumber.startsWith(term));
  const bySku = new Map<string, UnifiedLegacySourceLine[]>();
  for (const line of lines) {
    if (!rule.items.some((group) => matches(line, group))) continue;
    if (!line.id || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error('INVALID_PROMOTION_CANDIDATE');
    if (line.unitPriceCents === null) continue;
    if (!Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents <= 0 || line.product.price == null
      || moneyCents(line.product.price) !== line.unitPriceCents) throw new Error('PROMOTION_SKU_PRICE_MISMATCH');
    const key = promotionSkuKey(line); const group = bySku.get(key) ?? [];
    group.push(line); bySku.set(key, group);
  }
  if (bySku.size > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  const keys = [...bySku.keys()].sort(); const selected = new Set<string>();
  const candidates: QualifiedPlanCandidate[] = []; let work = 0;
  const visit = (index: number) => {
    if (++work > maxWork) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    if (index < keys.length) {
      visit(index + 1); selected.add(keys[index]); visit(index + 1); selected.delete(keys[index]); return;
    }
    if (!selected.size) return;
    const rows = keys.filter((key) => selected.has(key)).flatMap((key) => bySku.get(key)!);
    work += rows.length * (1 + rule.items.length);
    if (work > maxWork) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    if (rule.items.some((group) => rows.filter((line) => matches(line, group)).reduce((sum, line) => sum + line.quantity, 0) < group.quantity)) return;
    const subtotal = rows.reduce((sum, line) => sum + line.unitPriceCents! * line.quantity, 0);
    if (!Number.isSafeInteger(subtotal) || subtotal <= 0) throw new Error('INVALID_PROMOTION_AMOUNT');
    const discount = rule.discountKind === 'fixed' ? Math.min(moneyCents(rule.discountValue), subtotal)
      : Math.round((subtotal / 100) * (1 - rule.discountValue) * 100);
    if (!Number.isSafeInteger(discount) || discount < 0 || discount > subtotal) throw new Error('INVALID_PROMOTION_AMOUNT');
    if (!discount) return;
    const shares = rows.map((line) => {
      const base = line.unitPriceCents! * line.quantity;
      if (!Number.isSafeInteger(base)) throw new Error('INVALID_PROMOTION_AMOUNT');
      const numerator = BigInt(discount) * BigInt(base);
      return { line, base, discount: Number(numerator / BigInt(subtotal)), remainder: numerator % BigInt(subtotal) };
    });
    let left = discount - shares.reduce((sum, share) => sum + share.discount, 0);
    const ordered = [...shares].sort((a, b) => a.remainder === b.remainder ? a.line.id!.localeCompare(b.line.id!) : a.remainder > b.remainder ? -1 : 1);
    for (const share of ordered) { if (!left) break; share.discount++; left--; }
    if (left) throw new Error('INVALID_PROMOTION_AMOUNT');
    const claims: QualifiedPlanCandidate['lines'] = [];
    for (const key of keys.filter((item) => selected.has(item))) {
      const parts = shares.filter((share) => promotionSkuKey(share.line) === key);
      const first = parts[0].line; let count = parts.reduce((sum, part) => sum + part.line.quantity, 0);
      let total = parts.reduce((sum, part) => sum + part.base - part.discount, 0);
      const bands = parts.flatMap((part) => allocateUnitBands(part.line.quantity, part.base - part.discount,
        part.discount ? 'promotion' : 'ordinary', part.line.id));
      for (const row of remainingStaticSkuRows(lines, key, bySku.get(key)!)) {
        count += row.quantity; total += row.unitPriceCents! * row.quantity;
        bands.push({ unitCents: row.unitPriceCents!, quantity: row.quantity, source: 'ordinary', sourceLineId: row.id });
      }
      if (!Number.isSafeInteger(count) || !Number.isSafeInteger(total)) throw new Error('INVALID_PROMOTION_AMOUNT');
      claims.push({ productId: first.productId, variantId: first.variantId, quantity: count, totalAfterCents: total, priceBands: bands });
    }
    const allocationId = JSON.stringify(claims);
    candidates.push({ promotionId: legacyRuleId(rule), allocationId, qualified: true, lines: claims });
    if (candidates.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  };
  visit(0); return candidates;
}

/** Enumerate all automatic quantities, preserving each original source row.
 * Selectable options remain explicit, matching the legacy selection contract.
 */
function forEachAutomaticAssignment(lines: UnifiedLegacySourceLine[], rule: AddonRuleConfig | GiftRuleConfig, now: Date,
  charge: () => void, visit: (assignment: ReturnType<typeof assignAutomaticPromotions>) => void): void {
  const allowAuto = promotionEngine.activeRules([rule], now).length > 0
    && (rule.type === 'gift' || (rule.sharedQuotaMode !== 'selection' && !rule.addonOptions?.length));
  const target = rule.type === 'gift' ? 0 : rule.addonPrice;
  const current: Array<CartLine & { id: string }> = []; const originals = new Map<string, string>();
  const walk = (index: number) => {
    charge();
    if (index === lines.length) { visit({ lines: [...current], originalIds: new Map(originals) }); return; }
    const line = lines[index]; if (!line.id) throw new Error('INVALID_PROMOTION_CANDIDATE');
    const eligible = allowAuto && !line.isQuickOrder && !line.promoMark && Number.isFinite(line.product.price)
      && (line.product.price ?? 0) > 0 && (line.product.price ?? 0) >= target
      && (rule.type === 'gift' ? isGiftProduct(rule, line.product) : isAddonProduct(rule, line.product));
    const max = eligible ? line.quantity : 0;
    for (let marked = 0; marked <= max; marked++) {
      charge();
      if (line.quantity > marked) { current.push({ ...line, id: line.id, quantity: line.quantity - marked }); originals.set(line.id, line.id); }
      if (marked) {
        const id = `${line.id}:auto:${rule.id}`;
        current.push({ ...line, id, quantity: marked, promoMark: { ruleId: rule.id, price: target } }); originals.set(id, line.id);
      }
      walk(index + 1);
      if (marked) { current.pop(); originals.delete(`${line.id}:auto:${rule.id}`); }
      if (line.quantity > marked) { current.pop(); originals.delete(line.id); }
    }
  };
  walk(0);
}

/** Enumerate add-on alternatives, including multiple explicitly selected option packs. */
export function enumerateLegacyAddonCandidates(lines: UnifiedLegacySourceLine[], rule: AddonRuleConfig, now: Date, maxWork = 100000, allowShared = false): QualifiedPlanCandidate[] {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) throw new Error('INVALID_PROMOTION_ENUMERATION');
  if (!Number.isSafeInteger(rule.minQuantity) || rule.minQuantity < 1) throw new Error('UNIFIED_STATIC_RULE_INVALID');
  if (rule.sharedQuotaGroup && !allowShared) throw new Error('UNIFIED_STATIC_SHARED_ADDON_UNSUPPORTED');
  const mainMatch = (line: CartLine) => !line.isQuickOrder && !line.promoMark && isEligibleMainProduct(rule, line.product);
  const groups = new Map<string, UnifiedLegacySourceLine[]>(); let totalQuantity = 0;
  for (const line of lines) {
    if (!line.id || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error('INVALID_PROMOTION_CANDIDATE');
    totalQuantity += line.quantity; if (!Number.isSafeInteger(totalQuantity) || totalQuantity > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    if (!mainMatch(line) && (line.isQuickOrder || (line.promoMark && line.promoMark.ruleId !== rule.id) || !isAddonProduct(rule, line.product))) continue;
    const key = promotionSkuKey(line); const rows = groups.get(key) ?? []; rows.push(line); groups.set(key, rows);
  }
  if (groups.size > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  const keys = [...groups.keys()].sort(); const selected = new Set<string>(); const candidates: QualifiedPlanCandidate[] = []; let work = 0;
  const visit = (index: number) => {
    if (++work > maxWork) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    if (index < keys.length) { visit(index + 1); selected.add(keys[index]); visit(index + 1); selected.delete(keys[index]); return; }
    if (!selected.size) return;
    const subset = lines.filter((line) => selected.has(promotionSkuKey(line)));
    work += subset.length * (1 + totalQuantity); if (work > maxWork) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    const charge = () => { if (++work > maxWork) throw new Error('PROMOTION_ENUMERATION_LIMIT'); };
    forEachAutomaticAssignment(subset, rule, now, charge, (assignment) => {
    const main = assignment.lines.filter(mainMatch);
    const selection = rule.sharedQuotaMode === 'selection' || Boolean(rule.addonOptions?.length);
    const mainCount = main.reduce((sum, line) => sum + line.quantity, 0);
    const quota = Math.floor(mainCount / rule.minQuantity) * (selection ? 1 : (rule.maxAddonsPerTrigger ?? 1));
    if (!Number.isSafeInteger(quota) || quota <= 0) return;
    const qualifiers = main.map((line) => {
      const sourceLineId = assignment.originalIds.get(line.id ?? '') ?? line.id;
      if (!sourceLineId) throw new Error('INVALID_PROMOTION_CANDIDATE');
      return { sourceLineId, productId: line.product.id, variantId: line.product.variantId ?? null,
        brand: line.product.brand, catalogNumber: line.product.catalogNumber, name: line.product.name ?? '', quantity: line.quantity };
    });
    const selections: Array<{ sourceLineId: string; productId: string; variantId: string | null; quantity: number; perSelection: number }> = [];
    let used = 0; let available = quota; const benefitBySource = new Map<string, Array<{ quantity: number; amount: number }>>();
    for (const line of assignment.lines) {
      if (line.isQuickOrder || line.promoMark?.ruleId !== rule.id || !isAddonProduct(rule, line.product)) continue;
      const option = rule.addonOptions?.find((item) => item.catalogNumber === line.product.catalogNumber && (!line.promoMark?.choice || line.promoMark.choice === item.catalogNumber));
      if (rule.addonOptions?.length && (!option || line.promoMark.choice !== option.catalogNumber)) throw new Error('ADDON_PRODUCT_INVALID');
      const expectedPrice = option?.price ?? rule.addonPrice;
      if (line.promoMark.price != null && Math.abs(line.promoMark.price - expectedPrice) > 0.005) throw new Error('ADDON_PRICE_INVALID');
      const per = option?.quantity ?? rule.addonQuantityPerTrigger ?? 1;
      if (!Number.isSafeInteger(per) || per <= 0 || (selection && line.quantity % per !== 0)) throw new Error('ADDON_QUOTA_EXCEEDED');
      used += selection ? Math.ceil(line.quantity / per) : line.quantity;
      const selectedSourceId = assignment.originalIds.get(line.id ?? '') ?? line.id;
      if (!selectedSourceId) throw new Error('INVALID_PROMOTION_CANDIDATE');
      selections.push({ sourceLineId: selectedSourceId, productId: line.product.id, variantId: line.product.variantId ?? null,
        quantity: line.quantity, perSelection: per });
      const eligibleQuantity = selection ? line.quantity : Math.min(line.quantity, available);
      if (!selection) available -= eligibleQuantity;
      if (!eligibleQuantity) continue;
      const originalId = assignment.originalIds.get(line.id ?? '') ?? line.id;
      const source = subset.find((row) => row.id === originalId); if (!source || source.unitPriceCents === null) throw new Error('PROMOTION_PRICE_COVERAGE_REQUIRED');
      const base = source.unitPriceCents * eligibleQuantity;
      const originalPrice = source.unitPriceCents / 100;
      const rawDiscount = option
        ? Math.max(0, originalPrice * eligibleQuantity - option.price * Math.ceil(eligibleQuantity / per))
        : Math.max(0, originalPrice - rule.addonPrice) * eligibleQuantity;
      const discount = Math.round(rawDiscount * 100);
      if (!Number.isSafeInteger(base) || !Number.isSafeInteger(discount) || discount < 0 || discount > base) throw new Error('INVALID_PROMOTION_AMOUNT');
      const parts = benefitBySource.get(source.id!) ?? [];
      parts.push({ quantity: eligibleQuantity, amount: base - discount }); benefitBySource.set(source.id!, parts);
    }
    if ((selection && used > quota) || !benefitBySource.size) return;
    const mainIds = new Set(main.map((line) => assignment.originalIds.get(line.id ?? '') ?? line.id));
    const selectedIds = new Set(selections.map((entry) => entry.sourceLineId));
    const claimKeys = new Set(subset.filter((line) => mainIds.has(line.id!) || selectedIds.has(line.id!) || benefitBySource.has(line.id!)).map(promotionSkuKey));
    const claims: QualifiedPlanCandidate['lines'] = []; let savings = 0;
    for (const key of [...claimKeys].sort()) {
      const rows = subset.filter((line) => promotionSkuKey(line) === key); let quantity = 0; let total = 0; let benefit = false;
      const bands: NonNullable<QualifiedPlanCandidate['lines'][number]['priceBands']> = [];
      for (const row of rows) {
        if (row.unitPriceCents === null || !Number.isSafeInteger(row.unitPriceCents) || row.unitPriceCents <= 0) throw new Error('PROMOTION_PRICE_COVERAGE_REQUIRED');
        const parts = benefitBySource.get(row.id!) ?? []; const usedQuantity = parts.reduce((sum, part) => sum + part.quantity, 0);
        if (usedQuantity > row.quantity) throw new Error('INVALID_PROMOTION_CANDIDATE');
        quantity += row.quantity;
        for (const part of parts) {
          const base = row.unitPriceCents * part.quantity; const discounted = part.amount < base;
          if (discounted) { benefit = true; savings += base - part.amount; }
          total += part.amount; bands.push(...allocateUnitBands(part.quantity, part.amount, discounted ? 'promotion' : 'ordinary', row.id));
        }
        const remaining = row.quantity - usedQuantity; total += remaining * row.unitPriceCents;
        if (remaining) bands.push({ unitCents: row.unitPriceCents, quantity: remaining, source: 'ordinary', sourceLineId: row.id });
      }
      if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(total)) throw new Error('INVALID_PROMOTION_AMOUNT');
      claims.push({ productId: rows[0].productId, variantId: rows[0].variantId, quantity, totalAfterCents: total,
        role: benefit ? 'benefit' : 'qualifier', priceBands: bands });
    }
    if (!savings) return;
    const sharedQuota = rule.sharedQuotaGroup ? { groupId: rule.sharedQuotaGroup, ruleId: legacyRuleId(rule), scope: {
      eligibleBrand: rule.eligibleBrand, eligibleTerms: [...rule.eligibleTerms], eligibleExactTerms: [...(rule.eligibleExactTerms ?? [])],
      eligibleNameIncludes: [...(rule.eligibleNameIncludes ?? [])], minQuantity: rule.minQuantity, selection,
      maxAddonsPerTrigger: rule.maxAddonsPerTrigger ?? 1,
    }, qualifiers, selections, baselineSelections: [] } : undefined;
    const addonSelection = { ruleId: legacyRuleId(rule), selections };
    const allocationId = JSON.stringify([claims, sharedQuota ?? null, addonSelection]);
    if (candidates.some((item) => item.allocationId === allocationId)) return;
    candidates.push({ promotionId: legacyRuleId(rule), allocationId, qualified: true, lines: claims, addonSelection, ...(sharedQuota ? { sharedQuota } : {}) });
    if (candidates.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    });
  };
  visit(0); return candidates;
}

/** Enumerate gift choices from qualifying source quantities and configured quota. */
export function enumerateLegacyGiftCandidates(lines: UnifiedLegacySourceLine[], rule: GiftRuleConfig, now: Date, maxWork = 100000): QualifiedPlanCandidate[] {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) throw new Error('INVALID_PROMOTION_ENUMERATION');
  if (!Number.isSafeInteger(rule.minQuantity) || rule.minQuantity < 1 || (rule.specGifts ?? []).some((item) => !Number.isSafeInteger(item.minQuantity) || item.minQuantity < 1 || !Number.isSafeInteger(item.giftQuantity) || item.giftQuantity < 0)) throw new Error('UNIFIED_STATIC_RULE_INVALID');
  const isMain = (line: CartLine) => !line.isQuickOrder && !line.promoMark && (!rule.eligibleBrand || line.product.brand === rule.eligibleBrand)
    && (!rule.eligibleTerms?.length || rule.eligibleTerms.some((term) => line.product.catalogNumber.startsWith(term)));
  const bySku = new Map<string, UnifiedLegacySourceLine[]>(); let totalQuantity = 0;
  for (const line of lines) {
    if (!line.id || !Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error('INVALID_PROMOTION_CANDIDATE');
    totalQuantity += line.quantity;
    if (!Number.isSafeInteger(totalQuantity) || totalQuantity > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    if (!isMain(line) && (line.isQuickOrder || (line.promoMark && line.promoMark.ruleId !== rule.id) || !isGiftProduct(rule, line.product))) continue;
    const key = promotionSkuKey(line); const rows = bySku.get(key) ?? []; rows.push(line); bySku.set(key, rows);
  }
  if (bySku.size > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  const keys = [...bySku.keys()].sort(); const selected = new Set<string>(); const candidates: QualifiedPlanCandidate[] = []; let work = 0;
  const identity = (line: CartLine) => `${line.product.brand}:${line.product.catalogNumber}:${line.product.spec ?? ''}`;
  const visit = (index: number) => {
    if (++work > maxWork) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    if (index < keys.length) { visit(index + 1); selected.add(keys[index]); visit(index + 1); selected.delete(keys[index]); return; }
    if (!selected.size) return;
    const subset = lines.filter((line) => selected.has(promotionSkuKey(line)));
    work += subset.length * (1 + totalQuantity);
    if (work > maxWork) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    const charge = () => { if (++work > maxWork) throw new Error('PROMOTION_ENUMERATION_LIMIT'); };
    forEachAutomaticAssignment(subset, rule, now, charge, (assignment) => {
    const main = assignment.lines.filter(isMain); let quota = 0;
    if (rule.specGifts?.length) {
      for (const line of main) {
        const spec = (line.product.spec ?? line.product.catalogNumber).toLowerCase().replace(/\s/g, '');
        const match = rule.specGifts.find((item) => item.spec.toLowerCase().replace(/\s/g, '') === spec)
          ?? rule.specGifts.find((item) => spec.includes(item.spec.toLowerCase().replace(/\s/g, '')));
        if (match) quota += Math.floor(line.quantity / match.minQuantity) * match.giftQuantity;
      }
    } else quota = Math.floor(main.reduce((sum, line) => sum + line.quantity, 0) / rule.minQuantity) * (rule.maxGiftsPerTrigger ?? 1);
    if (!Number.isSafeInteger(quota) || quota <= 0) return;
    const same = new Map<string, number>();
    if (rule.sameProduct) {
      for (const line of main) same.set(identity(line), (same.get(identity(line)) ?? 0) + line.quantity);
      for (const [key, quantity] of same) same.set(key, Math.floor(quantity / rule.minQuantity) * (rule.maxGiftsPerTrigger ?? 1));
    }
    const giftQty = new Map<string, number>(); let available = quota;
    for (const line of assignment.lines) {
      if (line.isQuickOrder || line.promoMark?.ruleId !== rule.id || !isGiftProduct(rule, line.product)) continue;
      const n = Math.min(line.quantity, available, rule.sameProduct ? (same.get(identity(line)) ?? 0) : available);
      available -= n; if (rule.sameProduct) same.set(identity(line), (same.get(identity(line)) ?? 0) - n);
      const original = assignment.originalIds.get(line.id ?? '') ?? line.id;
      if (!original) throw new Error('INVALID_PROMOTION_CANDIDATE');
      giftQty.set(original, (giftQty.get(original) ?? 0) + n);
    }
    if (![...giftQty.values()].some((n) => n > 0)) return;
    const claimKeys = new Set([...main.map((line) => promotionSkuKey({ productId: line.product.id, variantId: line.product.variantId ?? null })),
      ...subset.filter((line) => giftQty.has(line.id!)).map(promotionSkuKey)]);
    const claims: QualifiedPlanCandidate['lines'] = [];
    for (const key of [...claimKeys].sort()) {
      const rows = subset.filter((line) => promotionSkuKey(line) === key); if (!rows.length) throw new Error('INVALID_PROMOTION_CANDIDATE');
      let count = 0; let total = 0; let free = 0; let missingCoverage = false; const bands: NonNullable<QualifiedPlanCandidate['lines'][number]['priceBands']> = [];
      for (const row of rows) {
        if (row.unitPriceCents !== null && (!Number.isSafeInteger(row.unitPriceCents) || row.unitPriceCents <= 0)) throw new Error('INVALID_PROMOTION_AMOUNT');
        const n = giftQty.get(row.id!) ?? 0; if (n > row.quantity) throw new Error('INVALID_PROMOTION_CANDIDATE');
        if (row.unitPriceCents === null && n < row.quantity) { missingCoverage = true; break; }
        free += n; count += row.quantity; total += (row.quantity - n) * (row.unitPriceCents ?? 0);
        if (row.quantity > n) bands.push({ unitCents: row.unitPriceCents!, quantity: row.quantity - n, source: 'ordinary', sourceLineId: row.id });
        if (n) bands.push({ unitCents: 0, quantity: n, source: 'promotion', sourceLineId: row.id });
      }
      if (missingCoverage) return;
      if (!Number.isSafeInteger(count) || !Number.isSafeInteger(total)) throw new Error('INVALID_PROMOTION_AMOUNT');
      claims.push({ productId: rows[0].productId, variantId: rows[0].variantId, quantity: count, totalAfterCents: total,
        role: free ? 'benefit' : 'qualifier', priceBands: bands, ...(rows.some((row) => row.unitPriceCents === null) ? { zeroPriceAuthorized: true } : {}) });
    }
    const allocationId = JSON.stringify(claims);
    if (candidates.some((candidate) => candidate.allocationId === allocationId)) return;
    candidates.push({ promotionId: legacyRuleId(rule), allocationId, qualified: true, lines: claims });
    if (candidates.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
    });
  };
  visit(0); return candidates;
}

/** Validates submitted marks once, then enumerates all static rule alternatives.
 * Unselected valid marked rows retain their server ordinary price; an unpriced
 * row still requires full coverage in the shared plan solver. The caller must
 * not apply the old adjustment engine again after selecting this plan.
 */
export function buildUnifiedLegacyPromotionCandidates(lines: UnifiedLegacySourceLine[], now: Date,
  rules: RuleConfig[] = PROMOTION_RULES, maxWork = 100000): { candidates: QualifiedPlanCandidate[]; evidence: UnifiedLegacyRuleEvidence[] } {
  if (!Number.isSafeInteger(maxWork) || maxWork < 1) throw new Error('INVALID_PROMOTION_ENUMERATION');
  const active = promotionEngine.activeRules(rules, now).filter((rule) => rule.type !== 'coupon');
  if (!active.length) {
    if (lines.some((line) => line.promoMark)) throw new Error('UNIFIED_PROMO_MARK_INVALID');
    return { candidates: [], evidence: [] };
  }
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  if (active.length > 200 || lines.length > 200 || !Number.isSafeInteger(totalQuantity) || totalQuantity > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  for (const rule of active) {
    if (rule.type !== 'addon' || !rule.sharedQuotaGroup) continue;
    if (!Number.isSafeInteger(rule.minQuantity) || rule.minQuantity <= 0
      || !Number.isSafeInteger(rule.maxAddonsPerTrigger ?? 1) || (rule.maxAddonsPerTrigger ?? 1) <= 0
      || ![rule.eligibleTerms, rule.eligibleExactTerms ?? [], rule.eligibleNameIncludes ?? []].every((terms) => Array.isArray(terms) && terms.every((term) => typeof term === 'string'))
      || (rule.addonOptions ?? []).some((option) => !Number.isSafeInteger(option.quantity) || option.quantity <= 0)) throw new Error('UNIFIED_STATIC_RULE_INVALID');
  }
  const evaluations = promotionEngine.evaluateAll(lines, active, now);
  if (validatePromoMarks(lines, evaluations).length) throw new Error('UNIFIED_PROMO_MARK_INVALID');
  const addonError = validateAddonPromotionLines(lines, evaluations);
  const exceededSelectionQuota = hasExceededSelectionAddonQuota(lines, evaluations);
  if (exceededSelectionQuota || (addonError && !['ADDON_NOT_TRIGGERED', 'ADDON_QUOTA_EXCEEDED'].includes(addonError))) throw new Error(addonError ?? 'ADDON_QUOTA_EXCEEDED');
  const giftError = validateGiftPromotionLines(lines, evaluations); if (giftError) throw new Error(giftError);
  if (hasMisbrandedEligibleAddonMain(lines, evaluations)) throw new Error('ADDON_PRODUCT_INVALID');
  const perRuleBudget = Math.floor(maxWork / active.length);
  if (!perRuleBudget) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  const baselines = new Map<string, Array<{ sourceLineId: string; productId: string; variantId: string | null; quantity: number; perSelection: number }>>();
  for (const line of lines) {
    if (!line.promoMark) continue;
    const rule = active.find((item) => item.id === line.promoMark!.ruleId);
    if (!rule || rule.type !== 'addon' || !rule.sharedQuotaGroup) continue;
    if (!line.id) throw new Error('INVALID_PROMOTION_CANDIDATE');
    const option = rule.addonOptions?.find((item) => item.catalogNumber === line.product.catalogNumber);
    const perSelection = option?.quantity ?? rule.addonQuantityPerTrigger ?? 1;
    if (!Number.isSafeInteger(perSelection) || perSelection <= 0) throw new Error('UNIFIED_STATIC_RULE_INVALID');
    const entries = baselines.get(rule.sharedQuotaGroup) ?? [];
    entries.push({ sourceLineId: line.id, productId: line.productId, variantId: line.variantId, quantity: line.quantity, perSelection });
    baselines.set(rule.sharedQuotaGroup, entries);
  }
  for (const entries of baselines.values()) entries.sort((a, b) => a.sourceLineId < b.sourceLineId ? -1 : a.sourceLineId > b.sourceLineId ? 1 : 0);
  const candidates: QualifiedPlanCandidate[] = [];
  for (const rule of active) {
    const alternatives = rule.type === 'stack-discount' ? enumerateLegacyStackCandidates(lines, rule, perRuleBudget)
      : rule.type === 'fixed-price' ? enumerateLegacyFixedCandidates(lines, rule, perRuleBudget)
        : rule.type === 'buy-n-get-m' ? enumerateLegacyBuyNCandidates(lines, rule, perRuleBudget)
          : rule.type === 'bundle' ? enumerateLegacyBundleCandidates(lines, rule, perRuleBudget)
            : rule.type === 'gift' ? enumerateLegacyGiftCandidates(lines, rule, now, perRuleBudget)
              : rule.type === 'addon' ? enumerateLegacyAddonCandidates(lines, rule, now, perRuleBudget, true) : [];
    for (const candidate of alternatives) {
      if (candidate.sharedQuota) candidate.sharedQuota.baselineSelections = baselines.get(candidate.sharedQuota.groupId) ?? [];
      candidates.push(candidate);
    }
    if (candidates.length > 200) throw new Error('PROMOTION_ENUMERATION_LIMIT');
  }
  return { candidates, evidence: active.map((rule) => ({ id: legacyRuleId(rule), name: rule.name, type: rule.type,
    canonicalConfig: canonicalLegacyRule(rule), exclusive: rule.exclusive === true, stackable: rule.stackable === true })) };
}

export type PromotionIssue = { ruleId: string; message: string };

/** 预览与下单均使用数据库确认的商品身份，客户端仅提供活动选择。 */
export function toVerifiedCartLines(items: VerifiedItem[], submitted: PriceLookupItem[]): CartLine[] {
  return items.map((item, index) => ({
    id: String(index),
    product: {
      id: item.productId ?? '', brand: item.brand ?? '',
      catalogNumber: item.catalogNumber ?? '', spec: item.spec,
      name: item.name, price: item.unitPrice,
      selectedPromotionId: item.selectedPromotionId ?? null,
      promotionIdentity: item.promotionIdentity ?? { state: 'unknown' },
      promotionPricingEvidence: item.promotionPricingEvidence,
    },
    quantity: item.quantity,
    isQuickOrder: item.source !== 'db',
    promoMark: submitted[index]?.promoMark ?? null,
  }));
}

export function validatePromoMarks(lines: CartLine[], evaluations: RuleEvaluation[]): PromotionIssue[] {
  const issues = new Map<string, PromotionIssue>();
  for (const line of lines) {
    if (!line.promoMark) continue;
    const { ruleId, price } = line.promoMark;
    const evaluation = evaluations.find((entry) => entry.rule.id === ruleId);
    let message = '';
    if (!evaluation?.active || !['addon', 'gift'].includes(evaluation.rule.type)) {
      message = '促销活动失效，请移除加购商品后重新选择';
    } else if (line.isQuickOrder) {
      message = '加购商品价格需要重新确认，请移除后重新选择';
    } else {
      const rule = evaluation.rule;
      const option = rule.type === 'addon'
        ? rule.addonOptions?.find((candidate) => candidate.catalogNumber === line.product.catalogNumber)
        : undefined;
      const expected = rule.type === 'addon' ? (option?.price ?? rule.addonPrice) : 0;
      const optionQuantity = option?.quantity ?? 1;
      const selectedPriceTotal = (line.product.price ?? 0) * optionQuantity;
      const authorizedUnpricedGift = rule.type === 'gift' && line.product.serverVerified === true && line.product.price === null;
      if ((!authorizedUnpricedGift && (line.product.price == null || !Number.isFinite(line.product.price)))
        || (!authorizedUnpricedGift && (option ? selectedPriceTotal < expected : line.product.price! < expected))) {
        message = '加购商品价格需要重新确认，请移除后重新选择';
      } else if (price != null && (typeof price !== 'number' || !Number.isFinite(price) || Math.abs(price - expected) > 0.005)) {
        message = '加购价格发生变化，请移除加购商品后重新选择';
      } else if (rule.type === 'addon' && rule.addonOptions?.length && !option) {
        message = '商品未参加所选加购活动，请移除后重新选择';
      } else if (evaluation.details?.overSharedQuota === true) {
        message = '本活动的换购额度已用完，请保留其中一件换购商品后重新结算';
      } else if ((rule.type === 'addon' && !isAddonProduct(rule, line.product))
        || (rule.type === 'gift' && !isGiftProduct(rule, line.product))) {
        message = '商品未参加所选加购活动，请移除后重新选择';
      } else {
        // 资格不足或超过额度时，本行保留原价；策略只会对可用额度生成优惠。
        // 购物车负责展示提示，订单服务端以相同结果完成最终计价。
      }
    }
    if (message) issues.set(ruleId, { ruleId, message });
  }
  return [...issues.values()];
}

export type PromoAdjustment = {
  type: `promotion_${string}`;
  label: string;
  amount: number; // 负数（立减）
  reason: string;
};

export type PromoComputation = {
  issues: PromotionIssue[];
  lineDiscounts: Record<string, number>;
  /** 活动优惠对应的商品行说明（原始购物车行 id → 活动名称） */
  linePromotionLabels: Record<string, string[]>;
  /** 全部规则的评估结果（供额度校验） */
  evals: RuleEvaluation[];
  /** 订单级负调整（换购/赠品/组合折扣） */
  adjustments: PromoAdjustment[];
  /** 优惠总额（正数） */
  discountTotal: number;
};

export type AddonValidationError =
  | 'PROMOTION_NOT_FOUND'
  | 'ADDON_NOT_TRIGGERED'
  | 'ADDON_QUOTA_EXCEEDED'
  | 'ADDON_PRODUCT_INVALID'
  | 'ADDON_PRICE_INVALID';

export type GiftValidationError =
  | 'PROMOTION_NOT_FOUND'
  | 'GIFT_NOT_TRIGGERED'
  | 'GIFT_QUOTA_EXCEEDED'
  | 'GIFT_PRODUCT_INVALID'
  | 'GIFT_PRICE_INVALID';

export function validateAddonPromotionLines(lines: CartLine[], evaluations: RuleEvaluation[]): AddonValidationError | null {
  let softError: AddonValidationError | null = null;
  for (const line of lines) {
    if (!line.promoMark) continue;
    const evaluation = evaluations.find((entry) => entry.rule.id === line.promoMark?.ruleId);
    if (!evaluation || !evaluation.active) return 'PROMOTION_NOT_FOUND';
    const addonRule = evaluation.rule;
    if (addonRule.type !== 'addon') continue;
    if (!evaluation.triggered) {
      softError ??= 'ADDON_NOT_TRIGGERED';
    }
    const quota = Number(evaluation.details?.quota ?? 0);
    const usedQuota = Number(evaluation.details?.usedQuota ?? 0);
    if (usedQuota > quota) {
      softError ??= 'ADDON_QUOTA_EXCEEDED';
    }
    const hasUnverifiedEligibleMain = lines.some((candidate) =>
      !candidate.promoMark && candidate.product.serverVerified === false
      && isEligibleMainProduct(addonRule, candidate.product));
    if (line.product.serverVerified === false || hasUnverifiedEligibleMain) return 'ADDON_PRODUCT_INVALID';
    if (!isAddonProduct(addonRule, line.product)) return 'ADDON_PRODUCT_INVALID';
    const option = addonRule.addonOptions?.find((candidate) => candidate.catalogNumber === line.product.catalogNumber);
    if (option && line.promoMark.choice !== option.catalogNumber) return 'ADDON_PRODUCT_INVALID';
    if (option && (line.quantity <= 0 || line.quantity % option.quantity !== 0)) return 'ADDON_PRODUCT_INVALID';
    const expectedPrice = option?.price ?? addonRule.addonPrice;
    if (line.promoMark.price != null && Math.abs(line.promoMark.price - expectedPrice) > 0.005) {
      return 'ADDON_PRICE_INVALID';
    }
  }
  return softError;
}

/** Reject over-quota selectable add-ons even if another marked add-on fails first. */
export function hasExceededSelectionAddonQuota(lines: CartLine[], evaluations: RuleEvaluation[]): boolean {
  return lines.some((line) => {
    const ruleId = line.promoMark?.ruleId;
    if (!ruleId) return false;
    const evaluation = evaluations.find((entry) => entry.rule.id === ruleId);
    if (!evaluation || evaluation.rule.type !== 'addon') return false;
    const selectionRule = evaluation.rule.sharedQuotaMode === 'selection' || Boolean(evaluation.rule.addonOptions?.length);
    if (!selectionRule) return false;
    return Number(evaluation.details?.usedQuota ?? 0) > Number(evaluation.details?.quota ?? 0);
  });
}

/** Reject a marked add-on paired with a wrong-brand main matching its qualifier. */
export function hasMisbrandedEligibleAddonMain(lines: CartLine[], evaluations: RuleEvaluation[]): boolean {
  return lines.some((line) => {
    if (line.promoMark) return false;
    return evaluations.some((evaluation) => {
      const rule = evaluation.rule;
      if (rule.type !== 'addon' || evaluation.triggered || !rule.eligibleBrand || line.product.brand === rule.eligibleBrand) return false;
      const name = line.product.name?.toLocaleLowerCase();
      const matches = rule.eligibleTerms.some((term) => line.product.catalogNumber.startsWith(term))
        || rule.eligibleExactTerms?.includes(line.product.catalogNumber) === true
        || Boolean(rule.eligibleNameIncludes?.length && rule.eligibleNameIncludes.every((term) => name?.includes(term.toLocaleLowerCase())));
      return matches && lines.some((candidate) => candidate.promoMark?.ruleId === rule.id);
    });
  });
}

export function validateGiftPromotionLines(lines: CartLine[], evaluations: RuleEvaluation[]): GiftValidationError | null {
  for (const line of lines) {
    if (!line.promoMark) continue;
    const evaluation = evaluations.find((entry) => entry.rule.id === line.promoMark?.ruleId);
    if (!evaluation || !evaluation.active) return 'PROMOTION_NOT_FOUND';
    if (evaluation.rule.type !== 'gift') continue;
    const giftRule = evaluation.rule as GiftRuleConfig;
    if (!evaluation.triggered) return 'GIFT_NOT_TRIGGERED';
    const giftQuota = Number(evaluation.details?.giftQuota ?? 0);
    const usedGifts = Number(evaluation.details?.usedGifts ?? 0);
    if (!Number.isFinite(giftQuota) || !Number.isFinite(usedGifts) || usedGifts > giftQuota) return 'GIFT_QUOTA_EXCEEDED';
    if (line.product.serverVerified === false
      || (giftRule.giftBrand && line.product.brand !== giftRule.giftBrand)
      || !giftRule.giftTerms.some((term) => line.product.catalogNumber.startsWith(term))) return 'GIFT_PRODUCT_INVALID';
    if (line.promoMark.price !== 0) return 'GIFT_PRICE_INVALID';
  }
  return null;
}

export function computePromoAdjustments(
  lines: CartLine[],
  now: Date = new Date(),
): PromoComputation {
  const automatic = assignAutomaticPromotions(lines, PROMOTION_RULES, now);
  const evals = promotionEngine.evaluateAll(automatic.lines, PROMOTION_RULES, now);
  const issues = validatePromoMarks(lines, evals);
  const invalidRules = new Set(issues.map((issue) => issue.ruleId));
  const computed = promotionEngine
    .dedupeAdjustments(evals)
    .filter((a) => a.amount > 0 && !invalidRules.has(a.ruleId));
  const lineDiscounts: Record<string, number> = {};
  const linePromotionLabels: Record<string, string[]> = {};
  for (const adjustment of computed) {
    if (adjustment.lineId != null) {
      const originalId = automatic.originalIds.get(adjustment.lineId) ?? adjustment.lineId;
      lineDiscounts[originalId] = (lineDiscounts[originalId] ?? 0) + adjustment.amount;
      linePromotionLabels[originalId] ??= [];
      if (!linePromotionLabels[originalId].includes(adjustment.name)) {
        linePromotionLabels[originalId].push(adjustment.name);
      }
    }
  }
  const adjustments: PromoAdjustment[] = computed
    .map((a) => ({
      type: `promotion_${a.type}` as const,
      label: a.name,
      amount: -a.amount,
      reason: a.description,
  }));
  const discountTotal = adjustments.reduce((s, a) => s + -a.amount, 0);
  return {
    evals,
    adjustments,
    discountTotal: Math.round(discountTotal * 100) / 100,
    issues,
    lineDiscounts,
    linePromotionLabels,
  };
}
