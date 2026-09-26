import { describe, expect, it } from 'vitest';
import { productCategories } from '@/data/categories';
import { SUBCATEGORY_IMAGES } from '@/lib/productImage';

describe('仪器设备子分类', () => {
  const instruments = productCategories.find((category) => category.name === '仪器设备');

  it('包含液氮储存与低温冰箱', () => {
    expect(instruments).toBeTruthy();
    const names = instruments!.sub.map((item) => item.name);
    expect(names).toContain('液氮储存');
    expect(names).toContain('低温冰箱');
  });

  it('为新增子分类配置了展示图', () => {
    expect(SUBCATEGORY_IMAGES['液氮储存']).toBe(
      '/images/categories/subcategories/materials-cryostorage-v1.webp',
    );
    expect(SUBCATEGORY_IMAGES['低温冰箱']).toBe(
      '/images/categories/subcategories/materials-temperature-tools-v2.webp',
    );
  });
});
