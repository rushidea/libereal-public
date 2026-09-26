import { describe, expect, it } from 'vitest';
import {
  applyPublicPriceFloor,
  computeAdjustedPrice,
  parseCatalogMatchRequest,
  parsePriceAdjustmentRequest,
  shouldSkipInquiryAdjustment,
} from '@/lib/pricing-adjustment-rules';

describe('price adjustment rules', () => {
  it('raises, lowers and sets public prices without going below zero', () => {
    expect(computeAdjustedPrice(100, { mode: 'percent', direction: 'increase', amount: 10 })).toBe(110);
    expect(computeAdjustedPrice(100, { mode: 'percent', direction: 'decrease', amount: 10 })).toBe(90);
    expect(computeAdjustedPrice(100, { mode: 'amount', direction: 'decrease', amount: 150 })).toBe(0);
    expect(computeAdjustedPrice(null, { mode: 'set', direction: 'increase', amount: 88.888 })).toBe(88.89);
    expect(computeAdjustedPrice(null, { mode: 'percent', direction: 'increase', amount: 10 })).toBeNull();
  });

  it('raises selling prices to the minimum sale price and leaves list prices unchanged', () => {
    expect(applyPublicPriceFloor(70, 80, 'price')).toEqual({ price: 80, floored: true });
    expect(applyPublicPriceFloor(70, 80, 'promotionalPrice')).toEqual({ price: 80, floored: true });
    expect(applyPublicPriceFloor(70, 80, 'originalPrice')).toEqual({ price: 70, floored: false });
  });

  it('accepts category and file requests without a brand or category', () => {
    expect(parsePriceAdjustmentRequest({
      scope: 'category',
      priceField: 'price',
      mode: 'percent',
      direction: 'increase',
      amount: 5,
      reason: '全站调价',
    }).ok).toBe(true);

    const parsed = parsePriceAdjustmentRequest({
      brand: 'CST',
      scope: 'category',
      priceField: 'price',
      mode: 'percent',
      direction: 'increase',
      amount: 5,
      includeVariants: false,
      reason: '年度调价',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.includeVariants).toBe(false);

    const fileParsed = parsePriceAdjustmentRequest({
      scope: 'catalog',
      mode: 'file',
      reason: '按表格调价',
      catalogItems: [{ catalogNumber: 'CAT-1', price: 110 }],
    });
    expect(fileParsed.ok).toBe(true);
  });

  it('skips inquiry products for percent or amount changes, but allows setting a public price', () => {
    expect(shouldSkipInquiryAdjustment('inquiry', 'percent')).toBe(true);
    expect(shouldSkipInquiryAdjustment('inquiry', 'amount')).toBe(true);
    expect(shouldSkipInquiryAdjustment('inquiry', 'set')).toBe(false);
    expect(shouldSkipInquiryAdjustment('inquiry', 'file')).toBe(false);
    expect(shouldSkipInquiryAdjustment('fixed', 'percent')).toBe(false);
  });

  it('accepts file-mode catalog items without a uniform amount', () => {
    const parsed = parsePriceAdjustmentRequest({
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      reason: '按表格调价',
      catalogItems: [
        { catalogNumber: 'CAT-1', price: 110, costPrice: 40, minimumSalePrice: 90 },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.mode).toBe('file');
    expect(parsed.value.catalogItems?.[0]).toMatchObject({ catalogNumber: 'CAT-1', price: 110, costPrice: 40 });
    expect(parsed.value.catalogNumbers).toEqual(['CAT-1']);
  });

  it('loads file-mode products by the imported catalog, not by spec text', () => {
    const parsed = parsePriceAdjustmentRequest({
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      reason: '按表格调价',
      catalogItems: [{ catalogNumber: 'CAT-1', spec: 'CAT-3', price: 110 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.catalogNumbers).toEqual(['CAT-1']);
  });

  it('accepts a catalog match request without a brand', () => {
    const parsed = parseCatalogMatchRequest({
      catalogItems: [{ catalogNumber: 'CAT-1', spec: '100ul', brand: 'CST' }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.brand).toBe('');
    expect(parsed.items).toEqual([
      { catalogNumber: 'CAT-1', spec: '100ul', brand: 'CST' },
    ]);
  });

  it('accepts a catalog match request without prices or a reason', () => {
    const parsed = parseCatalogMatchRequest({
      brand: 'CST',
      catalogItems: [{ catalogNumber: 'CAT-1', spec: '100ul' }, { catalogNumber: 'CAT-2' }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.brand).toBe('CST');
    expect(parsed.items).toEqual([
      { catalogNumber: 'CAT-1', spec: '100ul' },
      { catalogNumber: 'CAT-2' },
    ]);
  });

  it('keeps the imported product name on a catalog match request', () => {
    const parsed = parseCatalogMatchRequest({
      brand: 'CST',
      catalogItems: [{ catalogNumber: 'CAT-1', name: '另一商品' }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.items).toEqual([{ catalogNumber: 'CAT-1', name: '另一商品' }]);
  });

  it('keeps imported names on a formula catalog request', () => {
    const parsed = parsePriceAdjustmentRequest({
      brand: 'CST',
      scope: 'catalog',
      catalogNumbers: ['CAT-1'],
      catalogItems: [{ catalogNumber: 'CAT-1', name: '另一商品' }],
      priceField: 'price',
      mode: 'percent',
      direction: 'increase',
      amount: 10,
      includeVariants: false,
      reason: '年度调价',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.catalogItems?.[0]).toMatchObject({ catalogNumber: 'CAT-1', name: '另一商品' });
  });

  it('deduplicates imported catalog numbers without regard to letter case', () => {
    const parsed = parsePriceAdjustmentRequest({
      brand: 'CST',
      scope: 'catalog',
      catalogNumbers: ['Ab-1', 'ab-1', 'AB-1'],
      priceField: 'price',
      mode: 'percent',
      direction: 'increase',
      amount: 5,
      includeVariants: false,
      reason: '年度调价',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.catalogNumbers).toEqual(['Ab-1']);
  });
});
