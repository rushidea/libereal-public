import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import WechatArticleList from '@/components/discoveries/WechatArticleList';
import { getAllWechatArticleMetas } from '@/lib/wechat-articles';
import { canonicalSiteUrl } from '@/lib/site-url';
import { uiSurfaces } from '@/lib/ui-surfaces';

export const metadata: Metadata = {
  title: '全部文章',
  description: '实验室科普与行业观察全部文章。',
  alternates: {
    canonical: canonicalSiteUrl('/discoveries/articles'),
  },
};

export default function WechatArticlesArchivePage() {
  const articles = getAllWechatArticleMetas();

  return (
    <div className={`min-h-screen pb-16 lg:pb-0 ${uiSurfaces.servicePage}`}>
      <AdaptiveHeader showNav />
      <main className="mx-auto max-w-6xl px-4 pb-14 sm:px-6">
        <Link
          href="/discoveries"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand-color-text-secondary)] transition hover:text-[var(--brand-color-text)]"
        >
          <ArrowLeft size={16} />
          返回发现
        </Link>
        <h1 className="mb-6 text-2xl font-semibold text-[var(--brand-color-text)] sm:text-3xl">全部文章</h1>
        <WechatArticleList articles={articles} />
      </main>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
