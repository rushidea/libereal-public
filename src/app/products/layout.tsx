import type { Metadata } from 'next';
import { canonicalSiteUrl } from '@/lib/site-url';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: '产品目录',
  description:
    '浏览 LIBEREAL 生物试剂产品目录，涵盖抗体、ELISA试剂盒、蛋白、分子生物学试剂等，支持按品牌、类别、应用筛选与在线询价。',
  alternates: {
    canonical: canonicalSiteUrl('/products'),
  },
};

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
