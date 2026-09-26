import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import JsonLd from '@/components/JsonLd';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import { getAllWechatArticleSlugs, getWechatArticleBySlug } from '@/lib/wechat-articles';
import { buildBreadcrumbListJsonLd } from '@/lib/seo/json-ld';
import { canonicalSiteUrl, toAbsoluteCanonicalUrl } from '@/lib/site-url';
import { uiSurfaces } from '@/lib/ui-surfaces';

const PUBLISHER = 'LIBEREAL 天放生物';

export function generateStaticParams() {
  return getAllWechatArticleSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getWechatArticleBySlug(slug);
  if (!article) return { title: '文章未找到' };

  const url = canonicalSiteUrl(`/discoveries/${slug}`);
  const cover = article.cover ? toAbsoluteCanonicalUrl(article.cover) : undefined;
  return {
    title: article.title,
    description: article.summary,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: article.title,
      description: article.summary,
      url,
      publishedTime: article.publishedDate ?? article.date,
      modifiedTime: article.dateModified ?? article.publishedDate ?? article.date,
      images: cover ? [{ url: cover }] : undefined,
    },
  };
}

function formatDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getFullYear()} 年 ${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日`;
}

export default async function WechatArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getWechatArticleBySlug(slug);
  if (!article) notFound();

  const url = canonicalSiteUrl(`/discoveries/${slug}`);
  const displayDate = article.publishedDate ?? article.date;
  const modifiedDate = article.dateModified ?? displayDate;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.summary,
    image: article.cover ? toAbsoluteCanonicalUrl(article.cover) : undefined,
    datePublished: displayDate,
    dateModified: modifiedDate,
    mainEntityOfPage: url,
    author: { '@type': 'Organization', name: PUBLISHER },
    publisher: { '@type': 'Organization', name: PUBLISHER },
  };

  return (
    <div className={`min-h-screen pb-16 lg:pb-0 ${uiSurfaces.servicePage}`}>
      <AdaptiveHeader showNav />
      <main className="mx-auto max-w-3xl px-4 pb-14 sm:px-6">
        <Link
          href="/discoveries"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--brand-color-text-secondary)] transition hover:text-[var(--brand-color-text)]"
        >
          <ArrowLeft size={16} />
          返回发现
        </Link>

        <article className={`overflow-hidden rounded-lg ${uiSurfaces.panel}`}>
          <div className="relative aspect-[16/9] w-full bg-slate-200/60">
            <Image
              src={article.cover}
              alt={article.title}
              fill
              priority
              sizes="(max-width: 768px) 100vw, 768px"
              className="object-cover"
            />
          </div>

          <div className="px-5 py-6 sm:px-8 sm:py-8">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-600">
              {article.issue ? (
                <span className="font-semibold text-brand-700 dark:text-brand-800">{article.issue}</span>
              ) : null}
              <time dateTime={displayDate} className="font-mono tabular-nums">{formatDate(displayDate)}</time>
            </div>

            <h1 className="mt-3 text-2xl font-semibold leading-9 text-slate-950 text-pretty dark:text-slate-900 sm:text-3xl">
              {article.title}
            </h1>

            <div
              className="prose prose-slate dark:prose-invert mt-6 max-w-none prose-a:text-brand-700 dark:prose-a:text-brand-400 prose-img:rounded-lg"
              dangerouslySetInnerHTML={{ __html: article.contentHtml }}
            />

            {article.wechatFirst ? (
              <div className="mt-8 border-t border-slate-200/70 pt-5 text-sm text-slate-500 dark:border-slate-400/50 dark:text-slate-600">
                {article.wechatUrl ? (
                  <a
                    href={article.wechatUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-medium text-brand-700 transition hover:text-brand-900"
                  >
                    本文首发于微信服务号
                    <ExternalLink size={14} />
                  </a>
                ) : (
                  <span>本文首发于微信服务号。</span>
                )}
              </div>
            ) : null}
          </div>
        </article>
      </main>
      <SiteFooter />
      <MobileBottomNav />
      <JsonLd data={jsonLd} />
      <JsonLd
        data={buildBreadcrumbListJsonLd([
          { name: '首页', path: '/' },
          { name: '发现', path: '/discoveries' },
          { name: article.title },
        ])}
      />
    </div>
  );
}
