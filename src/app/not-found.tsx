import type { Metadata } from 'next';
import Link from 'next/link';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import { privatePageMetadata } from '@/lib/seo/robots';

export const metadata: Metadata = {
  ...privatePageMetadata,
  title: '该页面不存在',
};

export default function NotFound() {
  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-bold text-gray-900">该页面不存在</h1>
        <p className="mt-2 text-sm leading-6 text-gray-500">链接已失效，或地址填写有误。</p>
        <Link href="/" className="mt-6 inline-flex w-fit text-sm font-medium text-brand-600 hover:text-brand-700">
          返回首页
        </Link>
      </main>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
