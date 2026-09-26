import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { tracEngineeringKnowledge } from '@/data/knowledge/trac-engineering';
import { isKnowledgeStagingEnabled, productMatchesKnowledgeCard } from '@/lib/knowledge-staging';
import { getProductDetailHref } from '@/lib/product-href';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'TRAC 工程位点研究证据（内部预览）',
  description: 'TRAC 工程语境、证据边界与受限科研组件候选的内部 staging 预览。',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  other: { bingbot: 'noindex, nofollow, noarchive' },
};

export default async function TracEngineeringComponentsPage() {
  if (!isKnowledgeStagingEnabled()) notFound();

  const identities = await prisma.product.findMany({
    where: { id: { in: tracEngineeringKnowledge.products.map((product) => product.productId) } },
    select: { id: true, brand: true, catalogNumber: true, name: true, hazardous: true },
  });
  const identityById = new Map(identities.map((product) => [product.id, product]));
  const visibleProducts = tracEngineeringKnowledge.products.filter((card) => {
    const matches = productMatchesKnowledgeCard(card, identityById.get(card.productId));
    if (!matches) {
      console.error('[knowledge-staging] rejected product identity', {
        mappingId: card.mappingId,
        productId: card.productId,
      });
    }
    return matches;
  });

  return (
    <div className="min-h-screen bg-[#f7f6f3] text-[#2f3437]">
      <div className="border-b border-black/[0.07] bg-[#f7f6f3]">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <span className="font-serif text-lg tracking-[-0.02em] text-[#202124]">LIBEREAL</span>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#787774]">
            Internal knowledge preview
          </span>
        </div>
      </div>
      <main className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
        <header className="max-w-4xl border-b border-black/10 pb-12">
          <p className="mb-5 font-mono text-xs uppercase tracking-[0.14em] text-[#787774]">
            {tracEngineeringKnowledge.eyebrow} · {tracEngineeringKnowledge.releaseId} / {tracEngineeringKnowledge.consensusId}
          </p>
          <h1 className="max-w-3xl font-serif text-4xl leading-[1.08] tracking-[-0.035em] text-[#202124] sm:text-6xl">
            {tracEngineeringKnowledge.title}
          </h1>
          <p className="mt-7 max-w-3xl text-base leading-8 text-[#585b5d] sm:text-lg">
            {tracEngineeringKnowledge.scope}
          </p>
          <div className="mt-7 inline-flex rounded-full bg-[#edf3ec] px-3 py-1.5 text-xs font-semibold tracking-wide text-[#346538]">
            {tracEngineeringKnowledge.evidenceBadge}
          </div>
        </header>

        <section className="grid gap-5 py-12 md:grid-cols-[1.15fr_0.85fr]" aria-labelledby="scope-heading">
          <article className="rounded-xl border border-black/[0.07] bg-white p-7">
            <h2 id="scope-heading" className="text-lg font-semibold text-[#202124]">适用语境</h2>
            <p className="mt-4 leading-7 text-[#585b5d]">{tracEngineeringKnowledge.context}</p>
          </article>
          <article className="rounded-xl border border-black/[0.07] bg-[#fbf3db] p-7">
            <h2 className="text-lg font-semibold text-[#6f5100]">禁止外推</h2>
            <ul className="mt-4 space-y-2 text-sm leading-6 text-[#765d18]">
              {tracEngineeringKnowledge.requiredLimitations.map((limitation) => (
                <li key={limitation} className="border-b border-[#956400]/15 pb-2 last:border-0 last:pb-0">
                  {limitation}
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className="py-8" aria-labelledby="components-heading">
          <div className="max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-[#787774]">Component candidates</p>
            <h2 id="components-heading" className="mt-3 font-serif text-3xl tracking-[-0.025em] text-[#202124] sm:text-4xl">
              科研工作流组件
            </h2>
            <p className="mt-4 leading-7 text-[#666866]">
              这里展示的是证据受限的组件候选，不是推荐组合，也不是完整 TRAC 实验方案。
            </p>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {visibleProducts.map((product) => (
              <article key={product.mappingId} className="flex flex-col rounded-xl border border-black/[0.07] bg-white p-7">
                <div className="flex flex-wrap gap-2">
                  {product.riskLabels.map((label) => (
                    <span key={label} className="rounded-full bg-[#fdebec] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#9f2f2d]">
                      {label}
                    </span>
                  ))}
                </div>
                <h3 className="mt-6 text-xl font-semibold leading-7 text-[#202124]">{product.displayLabel}</h3>
                <p className="mt-2 font-mono text-xs leading-5 text-[#787774]">
                  {product.brand} · {product.catalogNumber} · {product.mappingId}
                </p>
                <p className="mt-5 text-sm font-medium text-[#346538]">{product.evidenceBadge}</p>
                <p className="mt-5 flex-1 border-l-2 border-[#9f2f2d]/30 pl-4 text-sm leading-7 text-[#66615f]">
                  {product.mandatoryDisclaimer}
                </p>
                <Link
                  href={getProductDetailHref(product.catalogNumber, product.brand)}
                  className="mt-7 inline-flex w-fit rounded-md bg-[#202124] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3a3b3c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#346538] focus-visible:ring-offset-2"
                >
                  查看商品详情
                </Link>
              </article>
            ))}
          </div>

          {visibleProducts.length !== tracEngineeringKnowledge.products.length ? (
            <p className="mt-5 rounded-lg border border-[#956400]/20 bg-[#fbf3db] px-4 py-3 text-sm text-[#765d18]">
              部分组件因商品身份复核未通过而隐藏。请查看内部 staging 日志。
            </p>
          ) : null}
        </section>

        <section className="py-16" aria-labelledby="coverage-heading">
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-[#787774]">Coverage and gaps</p>
          <h2 id="coverage-heading" className="mt-3 font-serif text-3xl tracking-[-0.025em] text-[#202124] sm:text-4xl">
            需求覆盖与证据空缺
          </h2>
          <div className="mt-8 divide-y divide-black/[0.07] border-y border-black/[0.07]">
            {tracEngineeringKnowledge.coverage.map((item) => (
              <article key={item.requirementId} className="grid gap-3 py-6 md:grid-cols-[8rem_1fr]">
                <div>
                  <p className="font-mono text-xs text-[#787774]">{item.requirementId}</p>
                  <p className={`mt-2 text-xs font-semibold ${item.status === 'component_only' ? 'text-[#956400]' : 'text-[#9f2f2d]'}`}>
                    {item.status === 'component_only' ? '部分覆盖' : '暂无候选'}
                  </p>
                </div>
                <div>
                  <h3 className="font-semibold text-[#202124]">{item.label}</h3>
                  <p className="mt-2 text-sm leading-7 text-[#5f6162]">{item.explanation}</p>
                  <p className="mt-2 text-sm leading-7 text-[#787774]">缺失证据：{item.missingEvidence}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="border-t border-black/[0.07] py-16" aria-labelledby="seo-review-heading">
          <div className="max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-[#787774]">Internal content model</p>
            <h2 id="seo-review-heading" className="mt-3 font-serif text-3xl tracking-[-0.025em] text-[#202124] sm:text-4xl">
              SEO 结构审阅
            </h2>
            <p className="mt-4 leading-7 text-[#666866]">
              以下内容仅用于检查搜索意图、章节结构与证据血缘，不会写入页面关键词，也不会进入公开索引。
            </p>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {tracEngineeringKnowledge.seoAssets.map((asset) => (
              <article key={asset.assetId} className="rounded-xl border border-black/[0.07] bg-white p-7">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-[#fdebec] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9f2f2d]">
                    noindex
                  </span>
                  <span className="rounded-full bg-[#fbf3db] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#956400]">
                    仅内部 staging
                  </span>
                  <span className="rounded-full bg-[#edf3ec] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#346538]">
                    Sol 已终审
                  </span>
                </div>
                <p className="mt-6 font-mono text-xs text-[#787774]">{asset.assetId} · {asset.contentType}</p>
                <h3 className="mt-2 text-xl font-semibold leading-7 text-[#202124]">{asset.primaryKeyword}</h3>
                <p className="mt-2 text-sm text-[#787774]">搜索意图：{asset.intent}</p>

                <div className="mt-6 border-t border-black/[0.07] pt-5">
                  <h4 className="text-sm font-semibold text-[#202124]">必备章节</h4>
                  <ol className="mt-3 space-y-2 text-sm leading-6 text-[#5f6162]">
                    {asset.requiredSections.map((section, index) => (
                      <li key={section} className="grid grid-cols-[1.5rem_1fr] gap-2">
                        <span className="font-mono text-xs text-[#9a9996]">{String(index + 1).padStart(2, '0')}</span>
                        <span>{section}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg bg-[#edf3ec] p-4">
                    <h4 className="text-xs font-semibold tracking-wide text-[#346538]">允许表达</h4>
                    <ul className="mt-2 space-y-1.5 text-xs leading-5 text-[#456b48]">
                      {asset.allowedClaims.map((claim) => <li key={claim}>{claim}</li>)}
                    </ul>
                  </div>
                  <div className="rounded-lg bg-[#fdebec] p-4">
                    <h4 className="text-xs font-semibold tracking-wide text-[#9f2f2d]">禁止表达</h4>
                    <ul className="mt-2 space-y-1.5 text-xs leading-5 text-[#88413f]">
                      {asset.disallowedClaims.map((claim) => <li key={claim}>{claim}</li>)}
                    </ul>
                  </div>
                </div>

                <div className="mt-6 border-t border-black/[0.07] pt-5 font-mono text-[11px] leading-5 text-[#787774]">
                  <p>研究证据：{asset.evidenceIds.join(' · ')}</p>
                  <p>产品证据：{asset.productEvidenceIds.join(' · ') || '无'}</p>
                  <p>产品映射：{asset.productMappingIds.join(' · ') || '无'}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="border-t border-black/[0.07] py-16" aria-labelledby="faq-review-heading">
          <div className="max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-[#787774]">Answer boundary review</p>
            <h2 id="faq-review-heading" className="mt-3 font-serif text-3xl tracking-[-0.025em] text-[#202124] sm:text-4xl">
              客服意图预览
            </h2>
            <p className="mt-4 leading-7 text-[#666866]">
              这是回答边界的只读检查，不是在线客服。所有意图均禁止自动推荐产品，并在超出证据范围时转人工支持。
            </p>
          </div>

          <div className="mt-8 divide-y divide-black/[0.07] border-y border-black/[0.07]">
            {tracEngineeringKnowledge.faqIntents.map((faq) => (
              <article key={faq.intentId} className="py-8">
                <div className="grid gap-7 lg:grid-cols-[0.8fr_1.2fr]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-[#787774]">{faq.intentId}</span>
                      <span className="rounded-full bg-[#fdebec] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#9f2f2d]">
                        仅查看、不推荐
                      </span>
                      <span className="rounded-full bg-[#edf3ec] px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#346538]">
                        Sol 已终审
                      </span>
                    </div>
                    <h3 className="mt-4 text-xl font-semibold leading-7 text-[#202124]">{faq.intentName}</h3>
                    <div className="mt-5">
                      <h4 className="text-xs font-semibold tracking-wide text-[#787774]">示例问题</h4>
                      <ul className="mt-2 space-y-2 text-sm leading-6 text-[#5f6162]">
                        {faq.exampleQuestions.map((question) => <li key={question}>“{question}”</li>)}
                      </ul>
                    </div>
                    <div className="mt-5 font-mono text-[11px] leading-5 text-[#878683]">
                      <p>研究证据：{faq.evidenceIds.join(' · ')}</p>
                      <p>产品证据：{faq.productEvidenceIds.join(' · ') || '无'}</p>
                      <p>产品映射：{faq.productMappingIds.join(' · ') || '无'}</p>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <h4 className="text-sm font-semibold text-[#202124]">回答前澄清</h4>
                        <ul className="mt-3 space-y-2 text-sm leading-6 text-[#5f6162]">
                          {faq.clarifyingQuestions.map((question) => <li key={question}>{question}</li>)}
                        </ul>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-[#202124]">回答提纲</h4>
                        <ol className="mt-3 space-y-2 text-sm leading-6 text-[#5f6162]">
                          {faq.answerOutline.map((item, index) => (
                            <li key={item}>{index + 1}. {item}</li>
                          ))}
                        </ol>
                      </div>
                    </div>
                    <div className="rounded-lg border border-[#956400]/20 bg-[#fbf3db] p-5">
                      <h4 className="text-xs font-semibold tracking-wide text-[#765d18]">强制免责声明</h4>
                      <p className="mt-2 text-sm leading-7 text-[#765d18]">{faq.mandatoryDisclaimer}</p>
                    </div>
                    <div className="border-l-2 border-[#9f2f2d]/30 pl-4">
                      <h4 className="text-xs font-semibold tracking-wide text-[#9f2f2d]">人工升级规则</h4>
                      <p className="mt-2 text-sm leading-6 text-[#66615f]">{faq.escalationRule}</p>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="border-t border-black/[0.07] px-4 py-8 text-center text-xs leading-5 text-[#787774] sm:px-6">
        内部 staging 证据预览 · 不构成产品推荐、完整实验方案或临床主张
      </footer>
    </div>
  );
}
