import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  productsFindMany: vi.fn(),
  auth: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    product: { findMany: mocks.productsFindMany },
  },
}));

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/product-display', () => ({ attachDisplayPrices: (items: unknown[]) => items, resolveIsFormalMember: async () => false }));

import { GET } from '@/app/api/products/hot/route';
import { isHotProductEligible } from '@/lib/hot-products';

function product(id: string, catalogNumber: string, brand = '示例品牌') {
  return {
    id,
    catalogNumber,
    brand,
    subBrand: null,
    name: `${brand} ${catalogNumber}`,
    category: '一抗',
    subcategory: '内参抗体',
    host: null,
    target: null,
    hazardous: false,
    spec: '100 μL',
    price: 420,
    promotionalPrice: null,
    promotion: false,
    originalPrice: null,
    inStock: true,
    stockQuantity: 1,
    leadTime: null,
    imageUrl: null,
    applications: '[]',
    reactivity: '[]',
  };
}

describe('GET /api/products/hot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(null);
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
  });

  it('returns eligible catalog items without campaign-specific pinning', async () => {
    const first = product('sample-1', 'SAMPLE-001');
    const second = product('sample-2', 'SAMPLE-002');
    mocks.productsFindMany.mockResolvedValueOnce([first, second]);
    const response = await GET(new NextRequest('https://libereal.cn/api/products/hot?limit=2'));
    const payload = await response.json() as { products: Array<{ catalogNumber: string }> };
    expect(response.status).toBe(200);
    expect(payload.products.map((item) => item.catalogNumber)).toEqual(['SAMPLE-001', 'SAMPLE-002']);
    expect(mocks.productsFindMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { updatedAt: 'desc' }, take: 6 }));
  });
});

describe('isHotProductEligible', () => {
  it('rejects synthetic payment-test products', () => {
    expect(isHotProductEligible({ id: 'test-product-alipay-1-cny', catalogNumber: 'other' })).toBe(false);
    expect(isHotProductEligible({ id: 'other', catalogNumber: 'LIBEREAL-TEST-001' })).toBe(false);
    expect(isHotProductEligible({ id: 'TEST-1YUAN', catalogNumber: 'TEST-1YUAN' })).toBe(false);
    expect(isHotProductEligible({ id: 'other', catalogNumber: 'other', name: '订单流程测试商品（1元）' })).toBe(false);
    expect(isHotProductEligible({ id: 'other', catalogNumber: 'other', brand: 'Libereal Test' })).toBe(false);
    expect(isHotProductEligible({ id: 'other', catalogNumber: 'SAMPLE-REFERENCE-001' })).toBe(true);
  });
});
