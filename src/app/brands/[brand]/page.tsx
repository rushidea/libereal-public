import JsonLd from '@/components/JsonLd';
import {
  getBrandDisplayName,
  resolveDbBrandName,
} from '@/data/brands';
import { ProductSearchService } from '@/lib/product-search';
import { sanitizeProductsWithVariants } from '@/lib/product-display';
import { buildBreadcrumbListJsonLd } from '@/lib/seo/json-ld';
import { brandCanonicalPath } from '@/lib/seo/public-urls';
import type { Product } from '@/types/Product';
import BrandProductsClient from './BrandProductsClient';

const PAGE_SIZE = 12;

export default async function BrandProductsPage({
  params,
}: {
  params: Promise<{ brand: string }>;
}) {
  const { brand } = await params;
  const brandSlug = decodeURIComponent(brand);
  const dbBrandName = resolveDbBrandName(brandSlug);
  const displayName = getBrandDisplayName(brandSlug);
  const result = await ProductSearchService.search({
    brands: [dbBrandName],
    page: 1,
    limit: PAGE_SIZE,
  });
  const products = sanitizeProductsWithVariants(result.products, false);

  return (
    <>
      <JsonLd
        data={buildBreadcrumbListJsonLd([
          { name: '首页', path: '/' },
          { name: '品牌中心', path: '/brands' },
          { name: displayName, path: brandCanonicalPath(dbBrandName) },
        ])}
      />
      <BrandProductsClient
        brand={brand}
        initialProducts={products as Product[]}
        initialTotal={result.pagination.total}
      />
    </>
  );
}
