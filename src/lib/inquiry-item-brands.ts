import { inquiryItemStoredBrand, inquiryItemView } from '@/lib/commerce-records';
import { prisma } from '@/lib/prisma';

type InquiryItemSource = Parameters<typeof inquiryItemView>[0];

const PRODUCT_ID_CHUNK = 400;

async function brandsForProductIds(ids: string[]): Promise<Map<string, string>> {
  const brandByProductId = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += PRODUCT_ID_CHUNK) {
    const products = await prisma.product.findMany({
      where: { id: { in: ids.slice(offset, offset + PRODUCT_ID_CHUNK) } },
      select: { id: true, brand: true },
    });
    for (const product of products) {
      const brand = product.brand.trim();
      if (brand) brandByProductId.set(product.id, brand);
    }
  }
  return brandByProductId;
}

/** 把询价明细转成接口视图。品牌优先取 metadata.brand，否则取关联商品的 brand。 */
export async function viewInquiryItems(items: InquiryItemSource[]) {
  const missingProductIds = [...new Set(items.flatMap((item) => (
    item.productId && !inquiryItemStoredBrand(item.metadata) ? [item.productId] : []
  )))];
  const brandByProductId = missingProductIds.length
    ? await brandsForProductIds(missingProductIds)
    : new Map<string, string>();

  return items.map((item) => inquiryItemView(item, {
    productBrand: item.productId ? brandByProductId.get(item.productId) ?? null : null,
  }));
}

/** 多张询价单共用一次商品品牌查询，避免列表接口按单查库。 */
export async function viewInquiryItemGroups<T extends InquiryItemSource>(groups: T[][]) {
  const viewed = await viewInquiryItems(groups.flat());
  let offset = 0;
  return groups.map((group) => {
    const items = viewed.slice(offset, offset + group.length);
    offset += group.length;
    return items;
  });
}
