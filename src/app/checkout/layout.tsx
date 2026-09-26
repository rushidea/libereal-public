import type { Metadata } from 'next';
import { privatePageMetadata } from '@/lib/seo/robots';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  ...privatePageMetadata,
  title: '收货地址',
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
