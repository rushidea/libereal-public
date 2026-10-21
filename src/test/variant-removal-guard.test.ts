import { describe, expect, it } from 'vitest';
import {
  findBlockedVariantRemovals,
  formatVariantRemovalBlockedMessage,
  variantIdFromItemMetadata,
  variantIdsReferencedByCart,
} from '@/lib/variant-removal-guard';

const removed = [
  { id: 'variant-100', catalogNumber: 'CAT-1-100', spec: '100 µL' },
  { id: 'variant-50', catalogNumber: 'CAT-1-50', spec: '50 µL' },
];

describe('variant removal guard', () => {
  it('reads only the variantId field from item metadata', () => {
    expect(variantIdFromItemMetadata(JSON.stringify({ variantId: 'variant-100', spec: '100 µL' }))).toBe('variant-100');
    expect(variantIdFromItemMetadata(JSON.stringify({ note: 'variant-100', variantId: null }))).toBeNull();
    expect(variantIdFromItemMetadata('{"variantId":')).toBeNull();
    expect(variantIdFromItemMetadata(null)).toBeNull();
  });

  it('recognizes selected, legacy, and single-package cart references', () => {
    expect(variantIdsReferencedByCart(JSON.stringify([
      { product: { id: 'product_1', variantId: 'variant-100', brand: 'CST', catalogNumber: 'CAT-1' }, quantity: 1 },
    ]))).toEqual(['variant-100', 'product_1']);

    expect(variantIdsReferencedByCart(JSON.stringify([
      { product: { id: 'variant-100', brand: 'CST', catalogNumber: 'CAT-1-100' }, quantity: 2 },
    ]))).toEqual(['variant-100']);

    expect(variantIdsReferencedByCart(JSON.stringify([
      { product: { id: 'product_1', variants: [{ id: 'variant-50' }] }, quantity: 1 },
    ]))).toEqual(['product_1', 'variant-50']);

    expect(variantIdsReferencedByCart(JSON.stringify([
      { product: { id: 'product_1', variants: [{ id: 'variant-50' }, { id: 'variant-100' }] }, quantity: 1 },
    ]))).toEqual(['product_1']);

    expect(variantIdsReferencedByCart('not-json')).toEqual([]);
  });

  it('blocks only exact references and keeps reason order stable', () => {
    const blocked = findBlockedVariantRemovals(removed, {
      inventoryVariantIds: ['variant-100', null],
      orderMetadata: [JSON.stringify({ variantId: 'variant-100-other', note: 'variant-100' })],
      inquiryMetadata: [JSON.stringify({ variantId: 'variant-50' })],
      quoteMetadata: [JSON.stringify({ variantId: 'variant-100' })],
      cartItems: [JSON.stringify([{ product: { id: 'product_1', variantId: 'variant-50' }, quantity: 1 }])],
    });

    expect(blocked).toEqual([
      { id: 'variant-100', catalogNumber: 'CAT-1-100', spec: '100 µL', reasons: ['inventory', 'quote'] },
      { id: 'variant-50', catalogNumber: 'CAT-1-50', spec: '50 µL', reasons: ['inquiry', 'cart'] },
    ]);
    expect(formatVariantRemovalBlockedMessage(blocked)).toBe(
      '无法保存，本次修改已全部取消。规格 CAT-1-100（100 µL）已有库存记录，被报价引用；规格 CAT-1-50（50 µL）被询价、购物车引用。这些规格不能删除，请重新打开商品并保留这些规格后再保存。',
    );
  });

  it('does not block a variant that is absent from every reference', () => {
    expect(findBlockedVariantRemovals(removed, {
      inventoryVariantIds: [],
      orderMetadata: [JSON.stringify({ variantId: 'someone-else' })],
      inquiryMetadata: [],
      quoteMetadata: [],
      cartItems: ['[]'],
    })).toEqual([]);
  });
});
