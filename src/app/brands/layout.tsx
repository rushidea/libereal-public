import type { Metadata } from 'next';
import { canonicalSiteUrl } from '@/lib/site-url';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: '合作品牌',
  description:
    'LIBEREAL 合作品牌一览，汇聚 Abcepta、Abcam、CST、Thermo Fisher 等国际知名生物试剂品牌，正品保障，支持在线采购与询价。',
  alternates: {
    canonical: canonicalSiteUrl('/brands'),
  },
};

export default function BrandsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
