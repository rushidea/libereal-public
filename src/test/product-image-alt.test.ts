import { describe, expect, it } from 'vitest';
import { getProductImageAlt } from '@/lib/productImage';

describe('getProductImageAlt', () => {
  it('uses brand, product name and catalog number when all are present', () => {
    expect(
      getProductImageAlt({
        brand: 'CST',
        name: 'Phospho-Akt Antibody',
        catalogNumber: '9272S',
        category: '抗体',
        subcategory: '一抗',
      }),
    ).toBe('CST Phospho-Akt Antibody 9272S');
  });

  it('falls back to subcategory for group images without a catalog number', () => {
    expect(
      getProductImageAlt({
        name: '细胞培养耗材',
        category: '耗材',
        subcategory: '培养皿',
      }),
    ).toBe('培养皿');
  });
});
