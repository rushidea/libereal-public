import type { Product } from '@/types/Product';

export type ProductFulfillmentPresentation = {
  label: string;
  detail: string;
  tone: 'success' | 'warning' | 'error';
};

/** Keep inventory and lead-time language consistent across purchase surfaces. */
export function getProductFulfillmentPresentation(
  product: Pick<Product, 'inStock' | 'stockQuantity' | 'leadTime' | 'salesUnit'>,
): ProductFulfillmentPresentation {
  const quantity = product.stockQuantity;
  if (!product.inStock || quantity === 0) {
    return {
      label: '暂时缺货',
      detail: product.leadTime ? `预计 ${product.leadTime}` : '可提交询价确认货期',
      tone: 'error',
    };
  }
  if (quantity != null && quantity > 0 && quantity <= 5) {
    return {
      label: '库存紧张',
      detail: `仅余 ${quantity}${product.salesUnit || '件'}${product.leadTime ? ` · ${product.leadTime}` : ''}`,
      tone: 'warning',
    };
  }
  return {
    label: '现货',
    detail: product.leadTime || '',
    tone: 'success',
  };
}
