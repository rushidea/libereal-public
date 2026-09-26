import { describe, expect, it } from 'vitest';
import { getProductDetailHref } from '@/lib/product-href';

describe('getProductDetailHref', () => {
  it('encodes catalog number and brand for the product detail route', () => {
    expect(getProductDetailHref('SH30243.01', 'Cytiva')).toBe(
      '/products/SH30243.01?brand=Cytiva',
    );
    expect(getProductDetailHref('SV30303.01', 'Cytiva HyClone')).toBe(
      '/products/SV30303.01?brand=Cytiva%20HyClone',
    );
  });
});
