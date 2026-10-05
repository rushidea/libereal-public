import { describe, expect, it } from 'vitest';
import { productCategories } from '@/data/categories';
import {
  getProductSeoCategory,
  productCategoryCatalogHref,
  productSeoCategories,
} from '@/data/product-seo';

describe('product SEO category landings', () => {
  it('defines five distinct, crawlable landing pages with unique copy and metadata', () => {
    expect(productSeoCategories.map(({ slug }) => slug)).toEqual([
      'antibodies', 'elisa-kits', 'western-blot-reagents', 'cell-culture-plates', 'cell-culture-flasks',
    ]);
    expect(new Set(productSeoCategories.map(({ title }) => title)).size).toBe(5);
    expect(new Set(productSeoCategories.map(({ description }) => description)).size).toBe(5);
    for (const category of productSeoCategories) {
      expect(category.heading.length).toBeGreaterThan(8);
      expect(category.intro.length).toBeGreaterThan(40);
      expect(category.selection.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('uses category and subcategory names present in the catalog taxonomy', () => {
    for (const category of productSeoCategories) {
      for (const filter of category.catalogFilters) {
        const root = productCategories.find(({ name }) => name === filter.category);
        expect(root, `${filter.category} should exist`).toBeDefined();
        if (filter.subcategory) {
          const subcategory = root?.sub.find(({ name }) => name === filter.subcategory);
          expect(subcategory, `${filter.subcategory} should exist under ${filter.category}`).toBeDefined();
          if (filter.productType) {
            expect(subcategory?.child?.includes(filter.productType), `${filter.productType} should exist under ${filter.subcategory}`).toBe(true);
          }
        } else if (filter.productType) {
          expect(root?.sub.some(({ name }) => name === filter.productType), `${filter.productType} should exist under ${filter.category}`).toBe(true);
        }
      }
    }
  });

  it('builds catalog links using the existing cat and sub URL parameters', () => {
    expect(productCategoryCatalogHref({ category: '一抗', subcategory: 'WB抗体' }))
      .toBe('/products/catalog?cat=%E4%B8%80%E6%8A%97&sub=WB%E6%8A%97%E4%BD%93');
    expect(productCategoryCatalogHref({ category: '材料合成', subcategory: '细胞培养器皿', productType: '细胞培养板' }))
      .toBe('/products/catalog?cat=%E6%9D%90%E6%96%99%E5%90%88%E6%88%90&sub=%E7%BB%86%E8%83%9E%E5%9F%B9%E5%85%BB%E5%99%A8%E7%9A%BF&type=%E7%BB%86%E8%83%9E%E5%9F%B9%E5%85%BB%E6%9D%BF');
    expect(productCategoryCatalogHref({ category: 'ELISA试剂盒' }))
      .toBe('/products/catalog?cat=ELISA%E8%AF%95%E5%89%82%E7%9B%92');
  });

  it('links Proteintech-related categories without implying listed stock or associating NovoProtein with antibody products', () => {
    const text = [
      getProductSeoCategory('antibodies')?.brandNote,
      getProductSeoCategory('western-blot-reagents')?.brandNote,
    ].join(' ');
    expect(text).toContain('Proteintech');
    expect(text).not.toContain('近岸蛋白');
    expect(text).toContain('不代表目录中已有对应现货');
  });

  it('returns no entry for unknown slugs', () => {
    expect(getProductSeoCategory('unknown')).toBeUndefined();
  });
});
