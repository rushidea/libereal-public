import { describe, expect, it } from 'vitest';
import { getVariantOptionCopy, mergeProductPackageOptions } from '@/lib/product-variants';

describe('mergeProductPackageOptions', () => {
  it('keeps the unit product alongside a multipack package variant', () => {
    const merged = mergeProductPackageOptions(
      { catalogNumber: 'SV30303.01', spec: '500mL', price: 55 },
      [{ id: 'v-case', catalogNumber: 'SV30303.01', spec: '500mL × 10瓶', price: 480 }],
    );

    expect(merged).toEqual([
      { catalogNumber: 'SV30303.01', spec: '500mL', price: 55 },
      { id: 'v-case', catalogNumber: 'SV30303.01', spec: '500mL × 10瓶', price: 480 },
    ]);
  });

  it('does not duplicate a base spec already present in package variants', () => {
    const merged = mergeProductPackageOptions(
      { catalogNumber: 'AM1981a', spec: '400 µl', price: 4550 },
      [
        { id: 'v-400', catalogNumber: 'AM1981a', spec: '400 µl', price: 4550 },
        { id: 'v-50', catalogNumber: 'AM1981a', spec: '50 µl', price: 1250 },
      ],
    );

    expect(merged).toEqual([
      { id: 'v-400', catalogNumber: 'AM1981a', spec: '400 µl', price: 4550 },
      { id: 'v-50', catalogNumber: 'AM1981a', spec: '50 µl', price: 1250 },
    ]);
  });

  it('returns empty when only one distinct package option exists', () => {
    const merged = mergeProductPackageOptions(
      { catalogNumber: 'X-1', spec: '500mL', price: 55 },
      [{ id: 'v-1', catalogNumber: 'X-1', spec: '500mL', price: 55 }],
    );
    expect(merged).toEqual([]);
  });
});

describe('getVariantOptionCopy', () => {
  it('shows packaging spec once without repeating the same line', () => {
    expect(getVariantOptionCopy({ catalogNumber: 'SV30303.01', spec: '500mL' })).toEqual({
      title: '500mL',
    });
    expect(getVariantOptionCopy({ catalogNumber: 'SV30303.01', spec: '500mL × 10瓶' })).toEqual({
      title: '500mL × 10瓶',
    });
  });

  it('keeps a distinct CST size label as subtitle when it differs from spec', () => {
    expect(getVariantOptionCopy({ catalogNumber: '12345T', spec: '20 µl' })).toEqual({
      title: '20 µl',
      subtitle: '试验装',
    });
  });

  it('falls back to size suffix label when spec is missing', () => {
    expect(getVariantOptionCopy({ catalogNumber: '12345S' })).toEqual({
      title: '标准装',
    });
  });
});
