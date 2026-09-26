import type { Metadata } from 'next';
import Link from 'next/link';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import ResearchTrendsExplorer from '@/components/research/ResearchTrendsExplorer';
import SiteFooter from '@/components/SiteFooter';
import { researchTrendsSnapshot } from '@/data/knowledge/research-trends';

export const metadata: Metadata = {
  title: '生命科学与医学研究热点',
  description: '按研究类别浏览 Libereal 整理的生命科学与医学研究热点及代表性来源。',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  other: { bingbot: 'noindex, nofollow, noarchive' },
};

export default function ResearchTrendsPage() {
  const formattedDate = researchTrendsSnapshot.asOfDate.replaceAll('-', '.');

  return (
    <div className="min-h-screen bg-[var(--brand-color-bg-layout)] pb-16 text-[var(--brand-color-text)] lg:pb-0">
      <AdaptiveHeader showNav />
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
        <header className="grid gap-10 border-b border-[var(--brand-color-border)] pb-12 lg:grid-cols-[1fr_18rem] lg:items-end sm:pb-16">
          <div className="max-w-4xl">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
              <span className="rounded-full bg-[var(--brand-color-success-bg)] px-2.5 py-1 text-[var(--brand-color-success-text)]">公开版</span>
              <span className="font-mono tracking-[0.12em] text-[var(--brand-color-text-quaternary)]">研究热点 · {researchTrendsSnapshot.researchWindow}</span>
            </div>
            <h1 className="mt-6 max-w-3xl font-serif text-4xl leading-[1.08] tracking-[-0.04em] text-[var(--brand-color-text)] sm:text-6xl">
              生命科学与医学研究热点
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-8 text-[var(--brand-color-text-secondary)] sm:text-lg">
              按研究类别整理论文、实验方法和转化研究，呈现值得继续阅读的方向及其适用边界。
            </p>
            <Link href="/discoveries" className="mt-6 inline-block text-sm font-semibold text-[var(--brand-color-text-interactive)] underline decoration-[var(--brand-color-border)] underline-offset-4">
              返回发现
            </Link>
          </div>
          <dl className="grid grid-cols-2 gap-x-5 gap-y-5 border-y border-[var(--brand-color-border)] py-5 lg:grid-cols-1">
            <div className="flex items-end justify-between gap-4">
              <dt className="text-xs text-[var(--brand-color-text-quaternary)]">研究类别</dt>
              <dd className="font-serif text-3xl text-[var(--brand-color-text)]">{researchTrendsSnapshot.categoryCount}</dd>
            </div>
            <div className="flex items-end justify-between gap-4">
              <dt className="text-xs text-[var(--brand-color-text-quaternary)]">研究方向</dt>
              <dd className="font-serif text-3xl text-[var(--brand-color-text)]">{researchTrendsSnapshot.hotspotCount}</dd>
            </div>
            <div className="flex items-end justify-between gap-4">
              <dt className="text-xs text-[var(--brand-color-text-quaternary)]">参考来源</dt>
              <dd className="font-serif text-3xl text-[var(--brand-color-text)]">{researchTrendsSnapshot.registeredSourceCount}</dd>
            </div>
            <div className="flex items-end justify-between gap-4">
              <dt className="text-xs text-[var(--brand-color-text-quaternary)]">资料更新</dt>
              <dd className="font-mono text-sm text-[var(--brand-color-text-secondary)]">{formattedDate}</dd>
            </div>
          </dl>
        </header>

        <section className="grid gap-4 py-10 md:grid-cols-2" aria-label="阅读说明">
          <article className="rounded-lg border border-[var(--brand-color-success-border)] bg-[var(--brand-color-success-bg)] p-5">
            <h2 className="text-sm font-semibold text-[var(--brand-color-success-text)]">怎样判断研究热点</h2>
            <p className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">
              页面收录的方向均有来自不同研究问题或方法的公开报道，并可追溯至原始来源。单篇论文适合作为线索，不能代表整个方向。
            </p>
          </article>
          <article className="rounded-lg border border-[var(--brand-color-warning-border)] bg-[var(--brand-color-warning-bg)] p-5">
            <h2 className="text-sm font-semibold text-[var(--brand-color-warning-text)]">阅读范围</h2>
            <p className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">
              本页用于了解研究方向和原始文献；临床判断、诊疗建议、实验方案和产品选择，仍须依据具体研究对象、实验条件及相关规范。
            </p>
          </article>
        </section>

        <ResearchTrendsExplorer snapshot={researchTrendsSnapshot} />
      </main>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
