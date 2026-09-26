import type { Metadata } from 'next';
import Link from 'next/link';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import TumorSpatialImmunityToc from '@/components/research/TumorSpatialImmunityToc';
import {
  spatialOrganizationTerms,
  tumorSpatialImmunityReferenceById,
  tumorSpatialImmunitySnapshot,
} from '@/data/knowledge/tumor-spatial-immunity';
import { uiSurfaces } from '@/lib/ui-surfaces';

const heroArtwork = {
  webp: '/images/research/trends/h022-tumor-spatial-immunity.webp',
  avif: '/images/research/trends/h022-tumor-spatial-immunity.avif',
};

export const metadata: Metadata = {
  title: '肿瘤空间免疫研究热点',
  description: '介绍肿瘤不同组织部位的免疫状态，以及多种癌症中反复出现的空间免疫共性和差异。',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  other: { bingbot: 'noindex, nofollow, noarchive' },
};

function SourceLinks({ sourceIds }: { sourceIds: string[] }) {
  const references = sourceIds
    .flatMap((sourceId) => {
      const reference = tumorSpatialImmunityReferenceById.get(sourceId);
      return reference ? [reference] : [];
    })
    .sort((left, right) => left.number - right.number);

  return (
    <span className="inline-flex flex-wrap gap-1.5" aria-label="支持该段内容的论文">
      {references.map((reference) => (
        <a
          key={reference.id}
          href={reference.url}
          target="_blank"
          rel="noreferrer"
          title={reference.title}
          className="font-mono text-[11px] font-semibold text-[var(--brand-color-text-interactive)] underline decoration-[var(--brand-color-border)] underline-offset-2"
        >
          [{reference.number}]
        </a>
      ))}
    </span>
  );
}

function SectionMarker({ number, label }: { number: string; label: string }) {
  return (
    <p className="flex items-center gap-2.5 text-base font-semibold leading-6 text-[var(--brand-color-text)] sm:text-lg">
      <span className="font-mono text-sm font-medium text-[var(--brand-color-text-interactive)]">{number}</span>
      <span className="text-[var(--brand-color-text-quaternary)]" aria-hidden="true">·</span>
      <span>{label}</span>
    </p>
  );
}

export default function TumorSpatialImmunityPage() {
  const formattedDate = tumorSpatialImmunitySnapshot.asOfDate.replaceAll('-', '.');

  return (
    <div className={`${uiSurfaces.page} min-h-screen pb-16 lg:pb-0`}>
      <AdaptiveHeader showNav />
      <main className="mx-auto w-full max-w-7xl px-4 pb-20 pt-10 sm:px-6 sm:pt-16">
        <header id="page-top" className="relative isolate scroll-mt-40 overflow-hidden border-b border-[var(--brand-color-border)] pb-10 sm:pb-14">
          <picture className="research-topic-hero-art research-topic-hero-art--integrated research-topic-hero-art--overview-background pointer-events-none absolute inset-0 z-0 block select-none">
            <source srcSet={heroArtwork.avif} type="image/avif" />
            <source srcSet={heroArtwork.webp} type="image/webp" />
            <img
              src={heroArtwork.webp}
              alt=""
              className="research-topic-hero-image h-full w-full object-cover object-[72%_center] sm:object-[right_center]"
            />
          </picture>
          <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
            <span className={uiSurfaces.badgeSuccess}>公开测试版</span>
            <span className="font-mono uppercase tracking-[0.12em] text-[var(--brand-color-text-quaternary)]">
              {tumorSpatialImmunitySnapshot.hotspotId} · {tumorSpatialImmunitySnapshot.researchWindow}
            </span>
          </div>
          <h1 className="mt-6 max-w-4xl font-serif text-3xl leading-[1.15] tracking-[-0.03em] text-[var(--brand-color-text)] sm:text-4xl">
            {tumorSpatialImmunitySnapshot.title}
          </h1>
          <p className="mt-5 max-w-4xl text-lg leading-8 text-[var(--brand-color-text)] sm:text-xl">
            {tumorSpatialImmunitySnapshot.subtitle}
          </p>
          <p className="mt-5 max-w-4xl text-base leading-8 text-[var(--brand-color-text-secondary)]">
            {tumorSpatialImmunitySnapshot.summary}
          </p>
          <aside className="mt-6 max-w-4xl border-l-2 border-[var(--brand-color-primary)] pl-4 text-sm leading-7 text-[var(--brand-color-text-secondary)]" aria-label="本页内容范围">
            {tumorSpatialImmunitySnapshot.scopeNote}
          </aside>
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <Link
              href="/research/trends"
              className="font-semibold text-[var(--brand-color-text-interactive)] underline decoration-[var(--brand-color-border)] underline-offset-4"
            >
              返回研究热点
            </Link>
            <span className="font-mono text-xs text-[var(--brand-color-text-quaternary)]">内容复核至 {formattedDate}</span>
          </div>
          </div>
        </header>

        <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12 xl:gap-16">
          <TumorSpatialImmunityToc />
          <div className="min-w-0">
            <section id="spatial-locations" className="scroll-mt-32 py-12 sm:py-16" aria-labelledby="spatial-locations-heading">
              <div className="max-w-3xl">
                <SectionMarker number="01" label="不同部位的免疫状态" />
                <h2 id="spatial-locations-heading" className="mt-4 font-serif text-2xl leading-tight tracking-[-0.02em] text-[var(--brand-color-text)]">
                  同一病灶内，不同区域承担不同的免疫作用
                </h2>
                <p className="mt-5 text-base leading-8 text-[var(--brand-color-text-secondary)]">
                  空间免疫研究首先要区分免疫细胞所在的组织部位。免疫细胞进入肿瘤实质、停留在侵袭边缘、聚集在血管周围或形成三级淋巴结构，分别反映不同的生物学状态。
                </p>
              </div>

              <dl className="mt-8 grid divide-y divide-[var(--brand-color-border)] overflow-hidden rounded-xl border border-[var(--brand-color-border)] bg-[var(--brand-color-border)] md:grid-cols-2 md:divide-y-0 md:gap-px xl:grid-cols-3">
                {spatialOrganizationTerms.map((term) => (
                  <div key={term.label} className="bg-[var(--brand-color-bg-container)] p-5 sm:p-6">
                    <dt className="font-mono text-xs font-semibold text-[var(--brand-color-text-interactive)]">{term.label}</dt>
                    <dd>
                      <h3 className="mt-3 text-lg font-semibold leading-7 text-[var(--brand-color-text)]">{term.title}</h3>
                      <p className="mt-3 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{term.text}</p>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section id="cross-cancer-themes" className="scroll-mt-32 border-t border-[var(--brand-color-border)] py-12 sm:py-16" aria-labelledby="cross-cancer-themes-heading">
              <div className="max-w-3xl">
                <SectionMarker number="02" label="跨癌症比较" />
                <h2 id="cross-cancer-themes-heading" className="mt-4 font-serif text-2xl leading-tight tracking-[-0.02em] text-[var(--brand-color-text)]">
                  多种癌症中反复出现的空间免疫现象
                </h2>
                <p className="mt-5 text-base leading-8 text-[var(--brand-color-text-secondary)]">
                  以下五类现象来自多种实体瘤研究。每一项先说明该部位的免疫特点，展开后可查看跨癌症的共同点、不同癌症中的差异，以及研究设计需要注意的内容。
                </p>
              </div>

              <div className="mt-10 divide-y divide-[var(--brand-color-border)] border-y border-[var(--brand-color-border)]">
                {tumorSpatialImmunitySnapshot.spatialThemes.map((theme) => (
                  <details key={theme.id} className="group">
                    <summary className="cursor-pointer list-none py-7 marker:hidden sm:py-8">
                      <div className="grid gap-4 lg:grid-cols-[15rem_1fr] lg:gap-10">
                        <div>
                          <p className="font-mono text-sm text-[var(--brand-color-text-interactive)]">{String(theme.displayOrder).padStart(2, '0')}</p>
                          <h3 className="mt-2 text-lg font-semibold leading-7 text-[var(--brand-color-text)]">{theme.title}</h3>
                          <p className="mt-2 text-xs leading-5 text-[var(--brand-color-text-quaternary)]">{theme.location}</p>
                        </div>
                        <div className="flex items-start justify-between gap-6">
                          <p className="text-base leading-8 text-[var(--brand-color-text)]">{theme.immuneDifference}</p>
                          <span className="mt-1 shrink-0 text-xl leading-none text-[var(--brand-color-text-quaternary)]" aria-hidden="true">
                            <span className="group-open:hidden">+</span>
                            <span className="hidden group-open:inline">−</span>
                          </span>
                        </div>
                      </div>
                    </summary>
                    <div className="grid gap-5 pb-8 lg:grid-cols-[15rem_1fr] lg:gap-10 sm:pb-9">
                      <div>
                        <p className="mb-2 text-xs text-[var(--brand-color-text-quaternary)]">代表性论文</p>
                        <SourceLinks sourceIds={theme.sourceIds} />
                      </div>
                      <dl className="space-y-5">
                        <div className={`${uiSurfaces.panel} p-5`}>
                          <dt className="text-sm font-semibold text-[var(--brand-color-text)]">共同点</dt>
                          <dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{theme.commonality}</dd>
                        </div>
                        <div className={`${uiSurfaces.panel} p-5`}>
                          <dt className="text-sm font-semibold text-[var(--brand-color-text)]">不同癌症中的差异</dt>
                          <dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{theme.variation}</dd>
                        </div>
                        <div className="border-l-2 border-[var(--brand-color-primary)] pl-5">
                          <dt className="text-sm font-semibold text-[var(--brand-color-text)]">研究设计需要注意什么</dt>
                          <dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{theme.researchValue}</dd>
                        </div>
                      </dl>
                    </div>
                  </details>
                ))}
              </div>
            </section>

            <section id="evidence-route" className="scroll-mt-32 border-t border-[var(--brand-color-border)] py-12 sm:py-16" aria-labelledby="evidence-route-heading">
              <div className="max-w-3xl">
                <SectionMarker number="03" label="研究技术" />
                <h2 id="evidence-route-heading" className="mt-4 font-serif text-2xl leading-tight tracking-[-0.02em] text-[var(--brand-color-text)]">
                  如何选择空间免疫研究技术
                </h2>
                <p className="mt-5 text-base leading-8 text-[var(--brand-color-text-secondary)]">
                  各种技术测量不同的对象。空间 RNA 记录基因表达的位置，多重蛋白成像直接观察蛋白和细胞，免疫受体组库分析用于追踪淋巴细胞克隆。展开技术卡可查看测量原理、样本设计、实验与分析流程、质控与独立确认，以及结果能解释到哪一步。
                </p>
              </div>
              <div className="mt-9 divide-y divide-[var(--brand-color-border)] border-y border-[var(--brand-color-border)]">
                {tumorSpatialImmunitySnapshot.spatialMethods.map((method) => (
                  <details key={method.id} className="group">
                    <summary className="cursor-pointer list-none py-6 marker:hidden sm:py-7">
                      <div className="grid gap-4 sm:grid-cols-[3rem_12rem_1fr] sm:items-start sm:gap-5">
                        <span className="font-mono text-xs text-[var(--brand-color-text-interactive)]">
                          {String(method.displayOrder).padStart(2, '0')}
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-[var(--brand-color-text-interactive)]">{method.category}</p>
                          <h3 className="mt-2 text-base font-semibold leading-6 text-[var(--brand-color-text)]">{method.title}</h3>
                        </div>
                        <div className="flex items-start justify-between gap-5">
                          <p className="text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.summary}</p>
                          <span className="mt-1 shrink-0 text-xl leading-none text-[var(--brand-color-text-quaternary)]" aria-hidden="true">
                            <span className="group-open:hidden">+</span>
                            <span className="hidden group-open:inline">−</span>
                          </span>
                        </div>
                      </div>
                    </summary>
                    <div className="grid gap-5 pb-8 sm:grid-cols-[3rem_12rem_1fr] sm:gap-5">
                      <span aria-hidden="true" />
                      <div>
                        <p className="mb-2 text-xs text-[var(--brand-color-text-quaternary)]">代表性研究</p>
                        <SourceLinks sourceIds={method.sourceIds} />
                      </div>
                      <dl className="space-y-5">
                        <div>
                          <dt className="text-sm font-semibold text-[var(--brand-color-text)]">测量原理</dt>
                          <dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.principle}</dd>
                        </div>
                        <div className="border-t border-[var(--brand-color-border)] pt-5">
                          <dt className="text-sm font-semibold text-[var(--brand-color-text)]">适合回答的问题</dt>
                          <dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.answers}</dd>
                        </div>
                        <div className="border-t border-[var(--brand-color-border)] pt-5">
                          <dt className="text-sm font-semibold text-[var(--brand-color-text)]">样本与实验设计</dt>
                          <dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.sampleDesign}</dd>
                        </div>
                        <div className="border-t border-[var(--brand-color-border)] pt-5">
                          <dt className="text-sm font-semibold text-[var(--brand-color-text)]">实验与分析流程</dt>
                          <dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.workflow}</dd>
                        </div>
                        <div className="border-t border-[var(--brand-color-border)] pt-5">
                          <dt className="text-sm font-semibold text-[var(--brand-color-text)]">质控与独立确认</dt>
                          <dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.qualityControl}</dd>
                        </div>
                        <div className="border-t border-[var(--brand-color-border)] pt-5">
                          <dt className="text-sm font-semibold text-[var(--brand-color-text)]">结果能解释到哪一步</dt>
                          <dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.resultInterpretation}</dd>
                        </div>
                        <div className="border-l-2 border-[var(--brand-color-warning)] pl-5">
                          <dt className="text-sm font-semibold text-[var(--brand-color-text)]">解释结果时需要注意</dt>
                          <dd className="mt-2 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{method.limitations}</dd>
                        </div>
                      </dl>
                    </div>
                  </details>
                ))}
              </div>
            </section>

            <section id="references" className="scroll-mt-32 border-t border-[var(--brand-color-border)] py-12 sm:py-16" aria-labelledby="references-heading">
              <div className="max-w-3xl">
                <SectionMarker number="04" label="参考文献" />
                <h2 id="references-heading" className="mt-4 font-serif text-2xl leading-tight tracking-[-0.02em] text-[var(--brand-color-text)]">
                  代表性论文与综述
                </h2>
                <p className="mt-5 text-sm leading-7 text-[var(--brand-color-text-secondary)]">
                  以下文献覆盖乳腺癌、结直肠癌、胰腺癌、肺癌、黑色素瘤、肾癌、脑肿瘤、卵巢癌、尿路上皮癌、头颈癌和皮肤鳞状细胞癌等研究。列表按发表年份排列，并将原始研究与综述分开标注。
                </p>
              </div>
              <details className="group mt-9 border-y border-[var(--brand-color-border)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 marker:hidden">
                  <span className="text-sm font-semibold text-[var(--brand-color-text)]">展开查看参考文献</span>
                  <span className="text-xl leading-none text-[var(--brand-color-text-quaternary)]" aria-hidden="true">
                    <span className="group-open:hidden">+</span>
                    <span className="hidden group-open:inline">−</span>
                  </span>
                </summary>
                <ol className="divide-y divide-[var(--brand-color-border)] border-t border-[var(--brand-color-border)]">
                  {tumorSpatialImmunitySnapshot.references.map((reference) => (
                    <li id={`reference-${reference.id}`} key={reference.id} className="scroll-mt-24 py-6">
                      <div className="grid gap-3 sm:grid-cols-[3rem_1fr]">
                        <span className="font-mono text-xs text-[var(--brand-color-text-quaternary)]">[{reference.number}]</span>
                        <div>
                          <p className="text-sm font-semibold leading-6 text-[var(--brand-color-text)]">{reference.title}</p>
                          <p className="mt-1 text-sm leading-6 text-[var(--brand-color-text-secondary)]">{reference.citation} ({reference.year})</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                            <span className="text-[var(--brand-color-text-quaternary)]">{reference.sourceType === 'review' ? '综述' : '原始研究'}</span>
                            <a
                              href={reference.url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-[var(--brand-color-text-interactive)] underline decoration-[var(--brand-color-border)] underline-offset-4"
                            >
                              DOI {reference.doi}
                            </a>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            </section>

            <aside className={`${uiSurfaces.panel} bg-[var(--brand-color-bg-layout)] p-5 text-sm leading-7 text-[var(--brand-color-text-secondary)] sm:p-6`}>
              本页整理公开发表的研究和综述，供科研人员了解方向进展。实验设计仍需结合具体癌症、病灶、取样时间和所用技术；本页仅供科研参考，不提供诊疗建议或治疗推荐。
              <p className="mt-3 text-sm leading-7 text-[var(--brand-color-text-quaternary)]">如有建议或发现错误，欢迎来函至：support@libereal.cn</p>
            </aside>
          </div>
        </div>
      </main>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
