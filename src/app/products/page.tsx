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
  title: '产品中心',
  description: '汇总 LIBEREAL 当前促销专题、促销产品与完整产品目录入口。',
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
