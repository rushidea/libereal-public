import { describe, expect, it } from 'vitest';
import {
  alignBrandDiscounts,
  brandMatchKey,
  formatBrandDiscountKey,
  lookupBrandDiscountRate,
  normalizeBrandToken,
  resolveCatalogBrandKey,
} from '@/lib/discount-brand-catalog';

const CATALOG = [
  'Abcam',
  'Biosharp',
  'CST',
  'Fisher BioReagents',
  'Labselect',
  'Sigma-Aldrich',
  'Thermo Fisher',
  'Thermo Fisher > FastDigest',
  'Thermo Fisher > Fisher BioReagents',
  'Thermo Fisher > Invariant',
];

describe('discount-brand-catalog', () => {
  it('normalizes whitespace and match keys', () => {
    expect(normalizeBrandToken('  Thermo   Fisher  ')).toBe('Thermo Fisher');
    expect(brandMatchKey('  Thermo   Fisher  ')).toBe('thermo fisher');
  });

  it('resolves case and spacing to catalog keys', () => {
    expect(resolveCatalogBrandKey('abcam', CATALOG)).toBe('Abcam');
    expect(resolveCatalogBrandKey('  Sigma-Aldrich ', CATALOG)).toBe('Sigma-Aldrich');
  });

  it('resolves CST display alias and Invariant casing', () => {
    expect(resolveCatalogBrandKey('Cell Signaling Technology', CATALOG)).toBe('CST');
    expect(resolveCatalogBrandKey('Thermo Fisher > invariant', CATALOG)).toBe('Thermo Fisher > Invariant');
  });

  it('resolves Fisher alias to catalog brand when present', () => {
    expect(resolveCatalogBrandKey('Fisher', CATALOG)).toBe('Fisher BioReagents');
  });

  it('aligns map keys, merges duplicates, and reports unmapped', () => {
    const result = alignBrandDiscounts({
      '  abcam ': 0.9,
      Abcam: 0.85,
      Fisher: 0.8,
      UnknownBrand: 0.7,
      'Thermo Fisher > invariant': 0.75,
    }, CATALOG);

    expect(result.aligned).toEqual({
      Abcam: 0.85,
      'Fisher BioReagents': 0.8,
      'Thermo Fisher > Invariant': 0.75,
    });
    expect(result.unmapped).toEqual(['UnknownBrand']);
    expect(result.renames.some((r) => r.from === 'Fisher' && r.to === 'Fisher BioReagents')).toBe(true);
  });

  it('looks up rates with normalized fallback', () => {
    const map = { CST: 0.88, 'Thermo Fisher > Invariant': 0.7 };
    expect(lookupBrandDiscountRate(map, 'Cell Signaling Technology')).toBe(0.88);
    expect(lookupBrandDiscountRate(map, 'Thermo Fisher', 'invariant')).toBe(0.7);
    expect(lookupBrandDiscountRate(map, 'Abcam')).toBeNull();
  });

  it('formats composite keys', () => {
    expect(formatBrandDiscountKey('Thermo Fisher', ' FastDigest ')).toBe('Thermo Fisher > FastDigest');
  });
});
