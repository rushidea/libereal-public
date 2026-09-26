export const HOT_PRODUCT_TEST_IDENTIFIERS = [
  'test-product-alipay-1-cny',
  'LIBEREAL-TEST-001',
  'TEST-1YUAN',
] as const;

export const HOT_PRODUCT_TEST_NAMES = [
  '支付宝支付测试商品（1元）',
  '订单流程测试商品（1元）',
] as const;

export const HOT_PRODUCT_TEST_BRANDS = ['Libereal Test'] as const;

const normalizedIdentifiers = new Set(HOT_PRODUCT_TEST_IDENTIFIERS.map((value) => value.toLowerCase()));
const normalizedNames = new Set(HOT_PRODUCT_TEST_NAMES.map((value) => value.toLowerCase()));
const normalizedBrands = new Set(HOT_PRODUCT_TEST_BRANDS.map((value) => value.toLowerCase()));

export function isHotProductEligible(product: {
  id: string;
  catalogNumber: string;
  name?: string;
  brand?: string;
}): boolean {
  return !normalizedIdentifiers.has(product.id.trim().toLowerCase())
    && !normalizedIdentifiers.has(product.catalogNumber.trim().toLowerCase())
    && !normalizedNames.has(product.name?.trim().toLowerCase() ?? '')
    && !normalizedBrands.has(product.brand?.trim().toLowerCase() ?? '');
}
