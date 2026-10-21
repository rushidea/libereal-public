import { describe, expect, it } from 'vitest';
import {
  findBlockedVariantRemovals,
  formatVariantRemovalBlockedMessage,
  variantIdFromItemMetadata,
  variantIdsReferencedByCart,
  type VariantRemovalEvidence,
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

  it('blocks variants still enrolled in an open promotion and lists the promotion names', () => {
    const now = new Date('2026-10-21T04:00:00.000Z');
    const blocked = findBlockedVariantRemovals(removed, evidence({
      now,
      promotions: [
        { variantId: 'variant-100', name: '开学季', status: 'active', endsAt: '2026-11-01T00:00:00.000Z' },
        { variantId: 'variant-100', name: '金秋促销', status: 'draft', endsAt: new Date('2026-12-01T00:00:00.000Z') },
        { variantId: 'variant-100', name: '金秋促销', status: 'paused', endsAt: '2026-12-01T00:00:00.000Z' },
        { variantId: 'variant-100', name: '已经结束', status: 'ended', endsAt: '2026-12-01T00:00:00.000Z' },
        { variantId: 'variant-100', name: '时间已过', status: 'active', endsAt: '2026-10-01T00:00:00.000Z' },
        { variantId: ' variant-100 ', name: ' 空白活动 ', status: 'active', endsAt: '2026-12-01T00:00:00.000Z' },
        { variantId: 'variant-50', name: '刚好结束', status: 'active', endsAt: now },
        { variantId: 'variant-50', name: '未开始的活动', status: 'active', endsAt: '2026-12-01T00:00:00.000Z' },
        { variantId: null, name: '商品级活动', status: 'active', endsAt: '2026-12-01T00:00:00.000Z' },
        { variantId: 'other-variant', name: '别的规格', status: 'active', endsAt: '2026-12-01T00:00:00.000Z' },
      ],
    }));

    const autumnNames = ['开学季', '金秋促销', '空白活动'].sort((left, right) => left.localeCompare(right, 'zh-CN'));
    expect(blocked).toEqual([
      { id: 'variant-100', catalogNumber: 'CAT-1-100', spec: '100 µL', reasons: [], promotionNames: autumnNames },
      { id: 'variant-50', catalogNumber: 'CAT-1-50', spec: '50 µL', reasons: [], promotionNames: ['未开始的活动'] },
    ]);
    const listed = autumnNames.map((name) => `「${name}」`).join('、');
    expect(formatVariantRemovalBlockedMessage(blocked)).toBe(
      `无法保存，本次修改已全部取消。规格 CAT-1-100（100 µL）参加了未结束的促销${listed}；规格 CAT-1-50（50 µL）参加了未结束的促销「未开始的活动」。这些规格不能删除，请先从这些促销中移除这些规格后再保存。`,
    );
  });

  it('does not block a variant that only belongs to an ended promotion', () => {
    const now = new Date('2026-10-21T04:00:00.000Z');
    expect(findBlockedVariantRemovals(removed, evidence({
      now,
      promotions: [
        { variantId: 'variant-100', name: '手工结束', status: 'ended', endsAt: '2026-12-01T00:00:00.000Z' },
        { variantId: 'variant-50', name: '时间已过', status: 'active', endsAt: now.getTime() },
        { variantId: 'variant-50', name: '坏掉的结束时间', status: 'paused', endsAt: 'not-a-date' },
      ],
    }))).toEqual([]);
  });

  it('keeps inventory wording and adds the promotion name when both apply', () => {
    const blocked = findBlockedVariantRemovals(
      [{ id: 'variant-100', catalogNumber: 'CAT-1-100', spec: '' }],
      evidence({
        inventoryVariantIds: ['variant-100'],
        now: new Date('2026-10-21T04:00:00.000Z'),
        promotions: [
          { variantId: 'variant-100', name: '金秋促销', status: 'active', endsAt: '2026-12-01T00:00:00.000Z' },
        ],
      }),
    );
    expect(formatVariantRemovalBlockedMessage(blocked)).toBe(
      '无法保存，本次修改已全部取消。规格 CAT-1-100已有库存记录，参加了未结束的促销「金秋促销」。该规格不能删除，请重新打开商品并保留该规格后再保存。参加了促销的规格请先从促销中移除。',
    );
  });
});

function evidence(overrides: Partial<VariantRemovalEvidence> = {}): VariantRemovalEvidence {
  return {
    inventoryVariantIds: [],
    orderMetadata: [],
    inquiryMetadata: [],
    quoteMetadata: [],
    cartItems: [],
    ...overrides,
  };
}
