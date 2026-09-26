import type { Prisma } from '@prisma/client';

/**
 * 危险化学品（hazardous = true）仅后台可见。
 * 顾客端所有商品查询（列表、搜索、详情、推荐、促销、筛选计数）都必须附带该条件，
 * 确保危化品从前端完全下架，而数据库记录与后台管理不受影响。
 */
export const STOREFRONT_HIDDEN_HAZARDOUS: Prisma.ProductWhereInput = { hazardous: false };
