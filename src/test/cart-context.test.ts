import { describe, expect, it } from 'vitest';
import {
  getProductCartKey,
  getCartItemKey,
  mergeCartProductItems,
  type CartItem,
} from '@/context/CartContext';
import type { Product } from '@/types/Product';

function product(overrides: Partial<Product>): Product {
  return {
    id: 'product-id',
    name: '测试商品',
    catalogNumber: 'CAT-1',
    brand: 'Abcam',
    price: 100,
    inStock: true,
    ...overrides,
  };
}

describe('cart product identity', () => {
  it('keeps regular and different promotion lines separate, merging only the same rule', () => {
    const p = product({});
    const rows: CartItem[] = [
      { product: p, quantity: 1 },
      { product: p, quantity: 1, addon: { ruleId: 'a', addonPrice: 50 } },
      { product: p, quantity: 2, addon: { ruleId: 'a', addonPrice: 50 } },
      { product: p, quantity: 1, addon: { ruleId: 'b', addonPrice: 50 } },
    ];
    const merged = mergeCartProductItems(rows);
    expect(merged.map((item) => item.quantity)).toEqual([1, 3, 1]);
    expect(new Set(merged.map(getCartItemKey)).size).toBe(3);
    expect(rows[1].quantity).toBe(1);
  });
  it('merges legacy catalog ids with database ids for the same product', () => {
    const legacyProduct = product({ id: 'CAT-1' });
    const currentProduct = product({ id: 'cuid-product-1' });
    const items: CartItem[] = [
      { product: legacyProduct, quantity: 1 },
      { product: currentProduct, quantity: 2 },
    ];

    const merged = mergeCartProductItems(items);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      product: { id: 'cuid-product-1', brand: 'Abcam', catalogNumber: 'CAT-1' },
      quantity: 3,
    });
  });

  it('keeps products with shared catalog numbers separate by brand', () => {
    const items: CartItem[] = [
      { product: product({ id: 'p1', brand: 'Abcam', catalogNumber: 'SHARED-1' }), quantity: 1 },
      { product: product({ id: 'p2', brand: 'MultiSciences', catalogNumber: 'SHARED-1' }), quantity: 1 },
    ];

    expect(mergeCartProductItems(items)).toHaveLength(2);
  });

  it('keeps product variants separate when catalog numbers match but specs differ', () => {
    const small = product({ id: 'variant-small', catalogNumber: 'BIO-1', spec: '50 ul' });
    const large = product({ id: 'variant-large', catalogNumber: 'BIO-1', spec: '100 ul' });

    expect(getProductCartKey(small)).not.toBe(getProductCartKey(large));
    expect(mergeCartProductItems([
      { product: small, quantity: 1 },
      { product: large, quantity: 1 },
    ])).toHaveLength(2);
  });
});
