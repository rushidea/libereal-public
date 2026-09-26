/**
 * Common Prisma select shapes for list views.
 * Centralizing these here keeps list rendering consistent and avoids
 * accidentally pulling heavy fields (description, cofaUrl, sdsUrl, pmids,
 * lotNumber, cloneNumber, expiryDate, storageBuffer, storageTemp, purity,
 * molecularWeight, isoelectricPoint, concentration) over the wire.
 *
 * Detail views use /api/products/[id] which returns all fields.
 */

import type { Prisma } from '@prisma/client';

/** Select for product list/card views (search results, home page, admin list). */
export const PRODUCT_LIST_SELECT = {
  id: true,
  catalogNumber: true,
  brand: true,
  subBrand: true,
  name: true,
  category: true,
  subcategory: true,
  host: true,
  target: true,
  hazardous: true,
  spec: true,
  price: true,
  promotionalPrice: true,
  promotion: true,
  originalPrice: true,
  inStock: true,
  stockQuantity: true,
  leadTime: true,
  imageUrl: true,
  applications: true,
  reactivity: true,
} satisfies Prisma.ProductSelect;

/** Select for product admin list (adds timestamps for audit + admin-only fields). */
export const PRODUCT_ADMIN_LIST_SELECT = {
  ...PRODUCT_LIST_SELECT,
  createdAt: true,
  updatedAt: true,
  costPrice: true, // 进货价 — admin only
  minimumSalePrice: true,
} satisfies Prisma.ProductSelect;

/** Select for inquiry list (admin view, archived). */
export const INQUIRY_LIST_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  institution: true,
  department: true,
  status: true,
  subtotal: true,
  inquiryItems: { orderBy: { position: 'asc' as const } },
  quotes: {
    orderBy: { version: 'desc' as const },
    take: 1,
    include: { items: { orderBy: { position: 'asc' as const } } },
  },
  createdAt: true,
  archivedAt: true,
} satisfies Prisma.InquirySelect;
