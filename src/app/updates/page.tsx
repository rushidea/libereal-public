import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import JsonLd from '@/components/JsonLd';
import { siteUpdates } from '@/data/site-updates';
import { canonicalSiteUrl } from '@/lib/site-url';
import { uiSurfaces } from '@/lib/ui-surfaces';

const title = '网站更新';
const description = '了解 LIBEREAL 生物试剂采购、在线询价、Western blot 与 ELISA 实验方案、实验问答和生命科学研究热点的更新。';

export const metadata: Metadata = {
  title: '网站更新：生物试剂采购与实验资料', description,
  alternates: { canonical: canonicalSiteUrl('/updates') },
  openGraph: { title: `${title} | LIBEREAL`, description, url: canonicalSiteUrl('/updates'), type: 'website', images: [{ url: canonicalSiteUrl('/images/home/resource-methods.webp'), alt: 'LIBEREAL 实验资料与网站更新' }] },
};

export default function UpdatesPage() {
  return (
    <div className={`min-h-screen flex flex-col pb-16 lg:pb-0 ${uiSurfaces.bgContainer}`}>
      <AdaptiveHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <nav aria-label="面包屑" className={`mb-6 flex flex-wrap gap-2 text-sm ${uiSurfaces.textSecondary}`}>
          <Link href="/" className={uiSurfaces.focusRing}>首页</Link><span aria-hidden="true">/</span><span aria-current="page">网站更新</span>
        </nav>
        <header className="pb-10 pt-4 text-center sm:pb-16">
          <h1 className={`text-3xl font-semibold tracking-tight sm:text-4xl ${uiSurfaces.titleText}`}>LIBEREAL 更新日志</h1>
          <p className={`mt-4 text-sm leading-6 ${uiSurfaces.textSecondary}`}>生物试剂采购、实验方法与科研阅读，持续更新。</p>
        </header>
        <div>
          {siteUpdates.map((update, index) => (
            <article key={update.id} id={update.id} className={`scroll-mt-40 border-b py-8 first:pt-0 sm:grid sm:grid-cols-[9rem_1fr] sm:gap-10 sm:py-10 ${uiSurfaces.border}`}>
              <time dateTime={update.date} className={`mb-4 block text-sm tabular-nums sm:pt-1 ${uiSurfaces.textSecondary}`}>{update.date.replaceAll('-', '.')}</time>
              <div className="min-w-0">
                <Image src={update.image.src} alt={update.image.alt} width={960} height={480} sizes="(max-width: 640px) calc(100vw - 32px), 740px" priority={index === 0} className={`aspect-[2/1] w-full rounded-lg border object-cover ${uiSurfaces.border}`} />
                <h2 className={`mt-5 text-xl font-semibold leading-snug ${uiSurfaces.titleText}`}>
                  <a href={`#${update.id}`} className={uiSurfaces.focusRing}>{update.title}</a>
                </h2>
                <p className={`mt-3 text-sm leading-7 ${uiSurfaces.text}`}>{update.description}</p>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
                  {update.links.map((link) => <Link key={link.href} href={link.href} className={`inline-flex items-center gap-1 text-sm underline underline-offset-4 ${uiSurfaces.textInteractive} ${uiSurfaces.focusRing}`}>{link.label}<ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link>)}
                </div>
              </div>
            </article>
          ))}
        </div>
        <JsonLd data={{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, description, url: canonicalSiteUrl('/updates') }} />
        <JsonLd data={{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首页', item: canonicalSiteUrl('/') },
          { '@type': 'ListItem', position: 2, name: title, item: canonicalSiteUrl('/updates') },
        ] }} />
      </main>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
