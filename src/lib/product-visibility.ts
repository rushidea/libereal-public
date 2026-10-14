import type { Prisma } from '@prisma/client';

/**
 * 顾客端商品查询的可见性条件。
 * 危险化学品（hazardous = true）仅后台可见。
 * 已软删除（deletedAt 非空）的商品从顾客端下架，订单、报价和库存记录仍保留。
 * 顾客端列表、搜索、详情、推荐和筛选计数应附带该条件。
 */
export const STOREFRONT_HIDDEN_HAZARDOUS: Prisma.ProductWhereInput = {
  hazardous: false,
  deletedAt: null,
};
