import type { Metadata } from 'next';
import { canonicalSiteUrl } from '@/lib/site-url';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: '技术支持',
  description: '实验方案、缓冲液配方、计算工具与常见实验问题。',
  alternates: {
    canonical: canonicalSiteUrl('/support'),
  },
};

export default function SupportLayout({ children }: { children: React.ReactNode }) {
  return children;
}
