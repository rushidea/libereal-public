import type { Metadata } from 'next';
import { getBrandDisplayName, getBrandInfo, resolveDbBrandName } from '@/data/brands';
import { canonicalSiteUrl } from '@/lib/site-url';

export const revalidate = 3600;

interface LayoutProps {
  params: Promise<{ brand: string }>;
  children: React.ReactNode;
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { brand } = await params;
  const brandSlug = decodeURIComponent(brand);
  const dbBrandName = resolveDbBrandName(brandSlug);
  const brandInfo = getBrandInfo(brandSlug);
  const displayName = getBrandDisplayName(brandSlug);

  const title = `${displayName} 产品`;
  const description =
    brandInfo?.description ??
    `浏览 ${displayName} 品牌生物试剂产品，正品保障，支持在线询价与采购。`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalSiteUrl(`/brands/${encodeURIComponent(dbBrandName)}`),
    },
  };
}

export default function BrandLayout({ children }: LayoutProps) {
  return children;
}
