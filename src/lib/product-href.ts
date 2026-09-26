/**
 * 产品详情页 URL。货号与品牌均编码，避免特殊字符导致路由失败。
 */
export function getProductDetailHref(catalogNumber: string, brand: string): string {
  return `/products/${encodeURIComponent(catalogNumber)}?brand=${encodeURIComponent(brand)}`;
}
