import { describe, expect, it } from 'vitest';
import { getProductFulfillmentPresentation } from '@/lib/product-fulfillment';

describe('product fulfillment presentation', () => {
  it('distinguishes in-stock, low-stock and replenishment states', () => {
    expect(getProductFulfillmentPresentation({ inStock: true, stockQuantity: 20, leadTime: '1-2 天', salesUnit: '盒' })).toEqual({
      label: '现货',
      detail: '1-2 天',
      tone: 'success',
    });
    expect(getProductFulfillmentPresentation({ inStock: true, stockQuantity: 2, leadTime: '3-5 天', salesUnit: '箱' })).toEqual({
      label: '库存紧张',
      detail: '仅余 2箱 · 3-5 天',
      tone: 'warning',
    });
    expect(getProductFulfillmentPresentation({ inStock: false, stockQuantity: 0, leadTime: '2-3 周', salesUnit: '盒' })).toEqual({
      label: '暂时缺货',
      detail: '预计 2-3 周',
      tone: 'error',
    });
  });

  it('does not invent a stock confirmation detail when no lead time is supplied', () => {
    expect(getProductFulfillmentPresentation({ inStock: true, stockQuantity: 20, salesUnit: '盒' })).toEqual({
      label: '现货',
      detail: '',
      tone: 'success',
    });
  });
});
