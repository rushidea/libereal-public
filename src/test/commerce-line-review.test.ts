import { describe, expect, it } from 'vitest';
import {
  CATALOG_PRICE_MAX_RATIO,
  CATALOG_PRICE_MIN_RATIO,
  DECIMAL_SHIFT_RELATIVE_TOLERANCE,
  commerceLineWarningPrompt,
  decideCommerceLineReview,
  mergeCommerceLineFindings,
  resolveCatalogUnitPrice,
  reviewCommerceLine,
  reviewCommerceLines,
  type CommerceLineFinding,
  type CommerceLineReviewer,
} from '@/lib/commerce-line-review';
import { QUOTE_QUANTITY_NUDGE_THRESHOLDS, classifyQuoteQuantityKind } from '@/lib/quote-quantity-nudge';

const catalog = 100;

function codes(input: Parameters<typeof reviewCommerceLine>[0]) {
  return reviewCommerceLine(input).findings.map((finding) => finding.code);
}

describe('commerce line review rules', () => {
  it('rejects non-positive and non-numeric unit prices', () => {
    for (const unitPrice of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'abc', '', '12元', null, undefined, true]) {
      const review = reviewCommerceLine({ name: '抗体', unitPrice, quantity: 1, catalogPrice: catalog });
      expect(review.errors.map((finding) => finding.code)).toEqual(['unit_price_invalid']);
      expect(review.warnings).toEqual([]);
    }
  });

  it('accepts a numeric price string and an integer quantity string', () => {
    expect(codes({ unitPrice: '80.00', quantity: '2', catalogPrice: catalog })).toEqual([]);
  });

  it('warns when the unit price is below 30% or above 300% of the catalog price', () => {
    expect(codes({ unitPrice: catalog * CATALOG_PRICE_MIN_RATIO, quantity: 1, catalogPrice: catalog })).toEqual([]);
    expect(codes({ unitPrice: 29.99, quantity: 1, catalogPrice: catalog })).toEqual(['unit_price_below_catalog']);
    expect(codes({ unitPrice: catalog * CATALOG_PRICE_MAX_RATIO, quantity: 1, catalogPrice: catalog })).toEqual([]);
    expect(codes({ unitPrice: 300.01, quantity: 1, catalogPrice: catalog })).toEqual(['unit_price_above_catalog']);
  });

  it('warns on a likely one-digit decimal shift around 10x or 0.1x', () => {
    const highEdge = catalog * 10 * (1 + DECIMAL_SHIFT_RELATIVE_TOLERANCE);
    const lowEdge = catalog * 0.1 * (1 - DECIMAL_SHIFT_RELATIVE_TOLERANCE);
    expect(codes({ unitPrice: catalog * 10, quantity: 1, catalogPrice: catalog })).toEqual([
      'unit_price_above_catalog',
      'unit_price_decimal_shift',
    ]);
    expect(codes({ unitPrice: Number(highEdge.toFixed(2)), quantity: 1, catalogPrice: catalog })).toContain('unit_price_decimal_shift');
    expect(codes({ unitPrice: catalog * 10 * (1 + DECIMAL_SHIFT_RELATIVE_TOLERANCE) + 1, quantity: 1, catalogPrice: catalog })).toEqual([
      'unit_price_above_catalog',
    ]);
    expect(codes({ unitPrice: catalog * 0.1, quantity: 1, catalogPrice: catalog })).toEqual([
      'unit_price_below_catalog',
      'unit_price_decimal_shift',
    ]);
    expect(reviewCommerceLine({ unitPrice: Number(lowEdge.toFixed(2)), quantity: 1, catalogPrice: catalog }).warnings
      .some((finding) => finding.code === 'unit_price_decimal_shift' && finding.message.includes('0.1 倍'))).toBe(true);
    expect(codes({ unitPrice: 20, quantity: 1, catalogPrice: catalog })).toEqual(['unit_price_below_catalog']);
    expect(codes({ unitPrice: 400, quantity: 1, catalogPrice: catalog })).toEqual(['unit_price_above_catalog']);
  });

  it('skips catalog comparisons when the catalog price is missing or not positive', () => {
    expect(codes({ unitPrice: 1, quantity: 1 })).toEqual([]);
    expect(codes({ unitPrice: 1, quantity: 1, catalogPrice: 0 })).toEqual([]);
    expect(codes({ unitPrice: 1, quantity: 1, catalogPrice: 'pending' })).toEqual([]);
  });

  it('rejects non-positive and non-integer quantities without also warning that they are large', () => {
    for (const quantity of [0, -2, 1.5, '1.5', '两', null, undefined, true]) {
      const review = reviewCommerceLine({
        name: '抗体', category: '一抗', unitPrice: catalog, quantity, catalogPrice: catalog,
      });
      expect(review.errors.map((finding) => finding.code)).toEqual(['quantity_invalid']);
      expect(review.warnings).toEqual([]);
    }
  });

  it('uses the quote acceptance quantity classification and thresholds', () => {
    expect(QUOTE_QUANTITY_NUDGE_THRESHOLDS).toEqual({ reagent: 10, consumable: 50 });
    expect(classifyQuoteQuantityKind({ category: '一抗' })).toBe('reagent');
    expect(codes({
      category: '一抗', unitPrice: catalog, quantity: QUOTE_QUANTITY_NUDGE_THRESHOLDS.reagent, catalogPrice: catalog,
    })).toEqual([]);
    expect(codes({
      name: '耗材样抗体', category: '一抗', unitPrice: catalog, quantity: QUOTE_QUANTITY_NUDGE_THRESHOLDS.reagent + 1, catalogPrice: catalog,
    })).toEqual(['quantity_abnormally_large']);
    expect(reviewCommerceLine({
      name: '耗材样抗体', category: '一抗', unitPrice: catalog, quantity: 11, catalogPrice: catalog,
    }).warnings[0].message).toContain('试剂');

    expect(codes({
      category: '材料合成', unitPrice: catalog, quantity: QUOTE_QUANTITY_NUDGE_THRESHOLDS.consumable, catalogPrice: catalog,
    })).toEqual([]);
    const consumable = reviewCommerceLine({
      name: '吸头', category: '材料合成', spec: '1000支/盒', unitPrice: catalog,
      quantity: QUOTE_QUANTITY_NUDGE_THRESHOLDS.consumable + 1, catalogPrice: catalog,
    });
    expect(consumable.warnings.map((finding) => finding.code)).toEqual(['quantity_abnormally_large']);
    expect(consumable.warnings[0].message).toContain('耗材');

    expect(codes({
      name: 'PCR 管', category: '分子生物学', subcategory: '分子生物学耗材', type: 'PCR 耗材',
      unitPrice: catalog, quantity: 11, catalogPrice: catalog,
    })).toEqual([]);
    expect(reviewCommerceLine({
      name: '普通试剂', category: '分子生物学', subcategory: '分子生物学耗材',
      unitPrice: catalog, quantity: 51, catalogPrice: catalog,
    }).warnings[0].message).toContain('耗材');
    expect(codes({
      category: '分子生物学', subcategory: '分子生物学试剂', unitPrice: catalog, quantity: 11, catalogPrice: catalog,
    })).toEqual(['quantity_abnormally_large']);

    for (const taxonomy of [
      { category: '仪器设备', subcategory: '实验室常规仪器', name: '离心机耗材' },
      { category: '新产品', name: '耗材新品' },
      { category: '生化试剂', name: '旧分类试剂' },
      { name: '实验耗材' },
      { subcategory: '移液与液体处理', type: '移液器吸头', name: '吸头' },
    ]) {
      expect(codes({ ...taxonomy, unitPrice: catalog, quantity: 99, catalogPrice: catalog })).toEqual([]);
    }
  });

  it('prefers the variant selling price as the catalog comparison price', () => {
    expect(resolveCatalogUnitPrice({
      variantPrice: 80,
      variantOriginalPrice: 120,
      productPrice: 100,
      productOriginalPrice: 150,
    })).toBe(80);
    expect(resolveCatalogUnitPrice({ variantPrice: 0, productOriginalPrice: 150, productPrice: 0 })).toBe(150);
    expect(resolveCatalogUnitPrice({ variantPrice: null, productPrice: null })).toBeNull();
  });

  it('keeps line identity and does not let confirmWarnings bypass hard errors', () => {
    const review = reviewCommerceLines([
      { lineId: 'a', name: '抗体', unitPrice: 0, quantity: 1 },
      { lineId: 'b', name: '吸头', category: '材料合成', unitPrice: 100, quantity: 60, catalogPrice: 100 },
    ]);
    expect(review.findings.map((finding) => [finding.index, finding.lineId, finding.code])).toEqual([
      [0, 'a', 'unit_price_invalid'],
      [1, 'b', 'quantity_abnormally_large'],
    ]);
    const blocked = decideCommerceLineReview(review, true);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.status).toBe(400);
      expect(blocked.body.code).toBe('COMMERCE_LINE_INVALID');
      expect(blocked.body.findings?.map((finding) => finding.code)).toEqual(['unit_price_invalid']);
    }
  });

  it('asks for confirmation of warnings and accepts only a boolean true', () => {
    const review = reviewCommerceLine({ category: '一抗', unitPrice: 10, quantity: 1, catalogPrice: catalog });
    expect(decideCommerceLineReview(review, false).ok).toBe(false);
    expect(decideCommerceLineReview(review, 'true').ok).toBe(false);
    const accepted = decideCommerceLineReview(review, true);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.warnings.map((finding) => finding.code)).toContain('unit_price_decimal_shift');
    expect(commerceLineWarningPrompt(review.warnings, '发布报价')).toContain('确认后仍要发布报价？');
  });

  it('merges future reviewer findings without dropping rule errors', () => {
    const ruleReview = reviewCommerceLine({ index: 0, unitPrice: 0, quantity: 1 });
    const reviewer: CommerceLineReviewer = () => [{
      code: 'unit_price_below_catalog',
      severity: 'warning',
      field: 'unitPrice',
      message: 'agent 补充警告',
      index: 0,
    }];
    const extra = reviewer({ source: 'quote', lines: [], ruleReview }) as CommerceLineFinding[];
    const merged = mergeCommerceLineFindings(ruleReview, [
      ...extra,
      ruleReview.errors[0],
    ]);
    expect(merged.errors).toHaveLength(1);
    expect(merged.warnings.map((finding) => finding.message)).toEqual(['agent 补充警告']);
  });
});
