import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import ProductsHomeClient from '@/app/products/ProductsHomeClient';
import { getProductPromotionCenterData } from '@/lib/product-promotion-center';
import { getFeaturedProductsForHome } from '@/lib/product-spec-count';
import { resolveIsFormalMember, sanitizeProductsWithVariants } from '@/lib/product-display';
import type { Product } from '@/types/Product';

import { canonicalSiteUrl } from '@/lib/site-url';

type ProductsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata: Metadata = {
  title: '抗体、ELISA 试剂盒、WB 试剂与细胞培养耗材',
  description: '在 LIBEREAL 按实验需求选购一抗、二抗、ELISA 试剂盒、Western Blot 试剂、细胞培养板与培养瓶。浏览品牌目录、比较应用与规格，结合实验选型资料按货号询价，确认供应情况和交期。',
  alternates: {
    canonical: canonicalSiteUrl('/products'),
  },
};

function buildQueryString(params: Record<string, string | string[] | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item) query.append(key, item);
      });
      return;
    }
    if (value) query.set(key, value);
  });
  return query.toString();
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const params = (await searchParams) ?? {};
  const queryString = buildQueryString(params);

  if (queryString) {
    redirect(`/products/catalog?${queryString}`);
  }

  const data = await getProductPromotionCenterData();
  const featuredProducts = await getFeaturedProductsForHome(5);
  const isFormalMember = await resolveIsFormalMember();

  // 方案③：服务端算展示价并剥离原始价（含变体）后再传给客户端
  const products = sanitizeProductsWithVariants(data.products, isFormalMember);
  const featured = sanitizeProductsWithVariants(featuredProducts, isFormalMember);

  return (
    <ProductsHomeClient
      features={data.features}
      products={products as Product[]}
      featuredProducts={featured as Product[]}
    />
  );
}
