import { describe, expect, it } from 'vitest';
import { toOrderItemCreates } from '@/lib/commerce-records';

describe('toOrderItemCreates variant metadata', () => {
  it('preserves variant identity in order item metadata', () => {
    const [row] = toOrderItemCreates([{ productId: 'p1', name: '抗体', price: 100, quantity: 1, variantId: 'variant-1' }]);
    expect(JSON.parse(String(row.metadata))).toMatchObject({ variantId: 'variant-1' });
  });

  it('keeps caller-provided order item metadata intact', () => {
    const [row] = toOrderItemCreates([{
      name: '抗体',
      price: 100,
      quantity: 1,
      variantId: 'other',
      metadata: JSON.stringify({ variantId: 'kept', spec: '100 µL' }),
    }]);
    expect(JSON.parse(String(row.metadata))).toEqual({ variantId: 'kept', spec: '100 µL' });
  });

  it('leaves metadata empty when the line has no variant', () => {
    const [row] = toOrderItemCreates([{ name: '试剂', price: 10, quantity: 1 }]);
    expect(row.metadata).toBeNull();
  });
});
