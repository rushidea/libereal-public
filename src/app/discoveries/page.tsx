import type { Metadata } from 'next';
import Image from 'next/image';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import DiscoveriesClient from '@/components/discoveries/DiscoveriesClient';
import DiscoveriesTabs, { type DiscoveriesTab } from '@/components/discoveries/DiscoveriesTabs';
import WechatArticleList from '@/components/discoveries/WechatArticleList';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import { getAllWechatArticleMetas } from '@/lib/wechat-articles';
import { WECHAT_ARTICLE_PREVIEW_COUNT } from '@/data/wechat-articles';
import { DISCOVERY_JOURNALS, type DiscoveryJournalId } from '@/data/discoveries';
import { canonicalSiteUrl } from '@/lib/site-url';
import { uiSurfaces } from '@/lib/ui-surfaces';

export const metadata: Metadata = {
  title: '发现',
  description: '实验室科普文章与生物医药期刊的近期论文。',
  alternates: {
    canonical: canonicalSiteUrl('/discoveries'),
  },
};

function isDiscoveryJournalId(value: string | undefined): value is DiscoveryJournalId {
  return DISCOVERY_JOURNALS.some((journal) => journal.id === value);
}

export default async function DiscoveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; journal?: string }>;
}) {
  const { tab, journal } = await searchParams;
  const activeTab: DiscoveriesTab = tab === 'journals' ? 'journals' : 'articles';
  const initialJournal = isDiscoveryJournalId(journal) ? journal : undefined;
  const articles = activeTab === 'articles' ? getAllWechatArticleMetas() : [];

  return (
    <div className={`min-h-screen pb-16 lg:pb-0 ${uiSurfaces.servicePage}`}>
      <AdaptiveHeader showNav />
      <main className="mx-auto max-w-6xl px-4 pb-14 sm:px-6">
        <header className="relative mb-7 h-40 overflow-hidden rounded-lg sm:h-52">
          <Image
            src="/images/home/resource-methods.webp"
            alt="查阅科研资料"
            fill
            priority
            sizes="(max-width: 768px) 100vw, 1152px"
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/72 via-slate-900/28 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
            <h1 className="text-3xl font-semibold text-white sm:text-4xl">发现</h1>
          </div>
        </header>

        <DiscoveriesTabs active={activeTab} />

        {activeTab === 'articles' ? (
          <WechatArticleList
            articles={articles.slice(0, WECHAT_ARTICLE_PREVIEW_COUNT)}
            showAllHref={articles.length > WECHAT_ARTICLE_PREVIEW_COUNT ? '/discoveries/articles' : undefined}
          />
        ) : (
          <DiscoveriesClient key={initialJournal ?? 'all'} initialJournal={initialJournal} />
        )}
      </main>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
