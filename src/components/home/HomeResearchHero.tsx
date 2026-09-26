'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { ArrowRight, ClipboardList, Search, ShieldCheck } from 'lucide-react';

import ResearchLifeMosaic from '@/components/home/ResearchLifeMosaic';
import { productCategories } from '@/data/categories';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface HomeResearchHeroProps {
  onSearch: (query: string) => void;
  onQuickOrder?: () => void;
}

const featuredCategories = productCategories
  .filter((category) => category.sub.length > 0)
  .slice(0, 5);

export default function HomeResearchHero({
  onSearch,
  onQuickOrder,
}: HomeResearchHeroProps) {
  const { status } = useSession();
  const [searchDraft, setSearchDraft] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchDraft.trim();
    if (!query) return;
    onSearch(query);
  };

  const accountHref = status === 'authenticated'
    ? '/account'
    : '/login?callbackUrl=/account';

  return (
    <section
      data-od-id="home-research-hero"
      className="px-4 pb-1 pt-4 sm:px-6 sm:pt-6"
      aria-labelledby="home-research-hero-title"
    >
      <div className={`mx-auto max-w-6xl overflow-hidden rounded-[var(--brand-border-radius)] p-3 sm:p-4 ${uiSurfaces.panelStrong}`}>
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(24rem,1.12fr)]">
          <div className={`flex min-w-0 flex-col rounded-[var(--brand-border-radius)] p-5 sm:p-8 lg:p-10 ${uiSurfaces.panel}`}>
            <p className="text-xs font-semibold tracking-[0.16em] text-brand-700 dark:text-brand-300">
              LIBEREAL · 生物医学科研服务平台
            </p>
            <h2
              id="home-research-hero-title"
              data-od-id="home-research-hero-heading"
              className={`mt-4 max-w-xl text-3xl font-semibold leading-tight text-pretty sm:text-4xl lg:text-[2.75rem] ${uiSurfaces.titleText}`}
            >
              从实验问题出发，找到下一步。
            </h2>
            <p className={`mt-4 max-w-xl text-base leading-7 sm:text-lg ${uiSurfaces.mutedText}`}>
              检索产品、浏览实验场景、查看方法资料，再把需要采购或确认的内容交给询价流程。
            </p>

            <form
              data-od-id="home-research-search"
              onSubmit={handleSubmit}
              className={`mt-6 flex min-w-0 flex-col gap-2 rounded-[var(--brand-border-radius)] p-2 sm:flex-row ${uiSurfaces.toolbar}`}
            >
              <label htmlFor="home-research-search-input" className="sr-only">搜索产品、货号或应用</label>
              <input
                id="home-research-search-input"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="搜索产品、货号或应用"
                className={`min-h-11 min-w-0 flex-1 ${uiSurfaces.input}`}
              />
              <button
                type="submit"
                data-od-id="home-research-search-submit"
                className={`${uiSurfaces.buttonPrimary} inline-flex min-h-11 shrink-0 items-center justify-center gap-2 px-4`}
              >
                <Search className="h-4 w-4" aria-hidden />
                搜索
              </button>
            </form>

            <div className="mt-5">
              <div className={`text-xs font-medium ${uiSurfaces.mutedText}`}>常用分类</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {featuredCategories.map((category) => (
                  <Link
                    key={category.name}
                    href={`/products?cat=${encodeURIComponent(category.name)}`}
                    className={`inline-flex min-h-9 items-center rounded-full px-3 text-xs font-medium transition hover:-translate-y-px hover:border-brand-300 hover:text-brand-700 ${uiSurfaces.badge} ${uiSurfaces.focusRing}`}
                  >
                    {category.name}
                  </Link>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Link
                href="/products"
                data-od-id="home-research-products-link"
                className={`${uiSurfaces.buttonSecondary} inline-flex min-h-11 items-center gap-2 px-4`}
              >
                浏览产品
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/inquiry"
                data-od-id="home-research-inquiry-link"
                className={`${uiSurfaces.buttonGhost} inline-flex min-h-11 items-center gap-2 px-3`}
              >
                提交询价
                <ClipboardList className="h-4 w-4" aria-hidden />
              </Link>
              {onQuickOrder ? (
                <button
                  type="button"
                  onClick={onQuickOrder}
                  className={`${uiSurfaces.buttonGhost} inline-flex min-h-11 items-center px-3`}
                >
                  按货号录入
                </button>
              ) : null}
            </div>

            <div className={`mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-7 text-xs ${uiSurfaces.mutedText}`}>
              <ShieldCheck className="h-4 w-4 text-brand-600" aria-hidden />
              <span>
                {status === 'authenticated' ? '账户已连接，收藏与采购记录持续同步' : '登录后同步收藏与采购记录'}
              </span>
              <Link href={accountHref} className="font-semibold text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200">
                {status === 'authenticated' ? '进入账户' : '登录账户'}
              </Link>
            </div>
          </div>

          <div className="min-w-0 overflow-hidden rounded-[var(--brand-border-radius)]">
            <ResearchLifeMosaic />
          </div>
        </div>
      </div>
    </section>
  );
}
