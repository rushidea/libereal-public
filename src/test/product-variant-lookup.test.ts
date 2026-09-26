import { describe, expect, it } from 'vitest';
import {
  getCstBaseCatalogNumber,
  isCstCatalogSizeSibling,
  isDigitPrefixCatalogCollision,
  usesCatalogPrefixVariantFallback,
} from '@/lib/product-variant-lookup';

describe('product variant lookup', () => {
  it('limits catalog prefix fallback to CST', () => {
    expect(usesCatalogPrefixVariantFallback('CST')).toBe(true);
    expect(usesCatalogPrefixVariantFallback('Labselect')).toBe(false);
    expect(usesCatalogPrefixVariantFallback('Biosharp')).toBe(false);
  });

  it('detects digit-prefix collisions that polluted Labselect tip specs', () => {
    expect(isDigitPrefixCatalogCollision('FT-10', 'FT-100')).toBe(true);
    expect(isDigitPrefixCatalogCollision('FT-10', 'FT-1000')).toBe(true);
    expect(isDigitPrefixCatalogCollision('FT-100', 'FT-1000')).toBe(true);
    expect(isDigitPrefixCatalogCollision('FT-1000', 'FT-1000-R-S')).toBe(false);
    expect(isDigitPrefixCatalogCollision('FT-1000', 'FT-1000W')).toBe(false);
    expect(isDigitPrefixCatalogCollision('T-001-10', 'T-001-1000')).toBe(true);
  });

  it('keeps CST T/S/L siblings and rejects unrelated prefixes', () => {
    expect(getCstBaseCatalogNumber('12345T')).toBe('12345');
    expect(isCstCatalogSizeSibling('12345T', '12345S')).toBe(true);
    expect(isCstCatalogSizeSibling('12345T', '12345L')).toBe(true);
    expect(isCstCatalogSizeSibling('12345T', '123456T')).toBe(false);
    expect(isCstCatalogSizeSibling('12345T', '12345')).toBe(true);
  });

  it('documents that Labselect FT-1000 must not absorb W/LR siblings via startsWith', () => {
    const parent = 'FT-1000';
    const pollutedByStartsWith = [
      'FT-1000-LR',
      'FT-1000-LR-R-S',
      'FT-1000-R-S',
      'FT-1000W',
      'FT-1000W-R-S',
    ];
    // Without ProductVariant rows, Labselect no longer uses prefix fallback,
    // so none of these appear as "规格" on the FT-1000 detail page.
    expect(usesCatalogPrefixVariantFallback('Labselect')).toBe(false);
    for (const child of pollutedByStartsWith) {
      expect(child.startsWith(parent)).toBe(true);
    }
  });
});
