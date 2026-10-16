type CostPriceRecord = {
  costPrice?: unknown;
  variants?: Array<{ costPrice?: unknown }>;
  prices?: Array<{ kind?: string }>;
};

/** 去掉商品、包装和价格历史上的进货价。调用方需已确认当前角色不能查看进货价。 */
export function redactProductCostPrice<T extends CostPriceRecord>(product: T): T {
  const next = { ...product };
  delete next.costPrice;
  if (product.variants) {
    next.variants = product.variants.map((variant) => {
      const copy = { ...variant };
      delete copy.costPrice;
      return copy;
    });
  }
  if (product.prices) {
    next.prices = product.prices.filter((price) => price.kind !== 'cost');
  }
  return next;
}
