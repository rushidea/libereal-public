import { describe, expect, it } from 'vitest';
import { buildProductClassifyIndex, classifyProduct } from '@/data/product-smart-classify';
import { classifyImportRow, completePlacement } from '@/data/product-classification-import';

describe('classification import safety surface', () => {
  it('skips unsupported rows instead of assigning an antibody fallback', () => {
    expect(classifyImportRow(['SyntheticBrand', 'Unknown Thing 001', 'SYN-001'])).toBeNull();
  });

  it('normalizes fields and keeps only positive priced variants', () => {
    const row = ['  SyntheticBrand ', '  50mL 离心管 无菌 ', ' SYN-002 ', '', '', '', ' 1 box ', '12.5', '2 boxes', '0', '5 boxes', '8.25', '', '-1', '', 99, '', ' https://example.invalid/item '];
    const result = classifyImportRow(row);
    expect(result).toMatchObject({
      productData: { brand: 'SyntheticBrand', catalogNumber: 'SYN-002', price: 12.5, inStock: true, imageUrl: 'https://example.invalid/item' },
      variants: [{ spec: '5 boxes', price: 8.25 }],
    });
  });

  it('keeps catalog examples isolated by the index supplied by the caller', () => {
    const firstBrand = Array.from({ length: 20 }, (_, index) => ({ name: `Shared Widget ${index}`, brand: 'Brand A', category: '生化和细胞检测试剂盒', subcategory: '代谢检测试剂盒' }));
    const secondBrand = Array.from({ length: 20 }, (_, index) => ({ name: `Shared Widget ${index}`, brand: 'Brand B', category: '材料合成', subcategory: '管类与样本储存', type: '离心管' }));
    const first = classifyProduct({ name: 'Shared Widget 99', brand: 'Brand A' }, { index: buildProductClassifyIndex(firstBrand) });
    const second = classifyProduct({ name: 'Shared Widget 99', brand: 'Brand B' }, { index: buildProductClassifyIndex(secondBrand) });
    expect(first.ok && first.subcategory).toBe('代谢检测试剂盒');
    expect(second.ok && second.subcategory).toBe('管类与样本储存');
  });

  it('represents a no-type hit as null so stale L3 state is cleared', () => {
    const result = classifyProduct({ name: 'DMEM 高糖培养基', category: '材料合成', subcategory: '离心管', type: '离心管' });
    expect(result).toMatchObject({ ok: true, category: '细胞生物学', subcategory: '细胞培养试剂', type: null });
    if (result.ok) expect(completePlacement(result)).toEqual({ category: '细胞生物学', subcategory: '细胞培养试剂', type: null });
  });
});
