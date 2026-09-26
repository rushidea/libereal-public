import type { Metadata } from 'next';
import { canonicalSiteUrl } from '@/lib/site-url';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: '帮助与支持',
  description: 'LIBEREAL 下单、付款、发货、发票与售后说明。',
  alternates: {
    canonical: canonicalSiteUrl('/help'),
  },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
