import Link from 'next/link';
import {
  featuredResearchTrends,
  researchTrendDeepDiveHrefById,
  researchTrendsSnapshot,
} from '@/data/knowledge/research-trends';

export default function HomeResearchTrends() {
  return (
    <section className="px-4 py-12 sm:px-6 sm:py-16" aria-labelledby="home-research-trends-heading">
      <div className="mx-auto max-w-6xl rounded-xl border border-black/[0.08] bg-[#f1efe8] px-5 py-8 sm:px-8 sm:py-10">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-12">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-[#77736c]">Research intelligence · Public beta</p>
            <h2 id="home-research-trends-heading" className="mt-4 max-w-md font-serif text-3xl tracking-[-0.03em] text-[#252522] sm:text-4xl">
              从研究热点找到下一步问题
            </h2>
            <p className="mt-5 max-w-lg text-sm leading-7 text-[#625f59]">
              浏览 {researchTrendsSnapshot.categoryCount} 个研究领域与 {researchTrendsSnapshot.hotspotCount} 个持续跟踪热点。内容按月复核，先帮助理解方向，不直接给出临床结论或商品推荐。
            </p>
            <dl className="mt-7 grid grid-cols-3 gap-3 border-y border-black/10 py-5">
              <div>
                <dt className="text-[11px] text-[#817d76]">一级分类</dt>
                <dd className="mt-1 font-serif text-2xl text-[#252522]">{researchTrendsSnapshot.categoryCount}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[#817d76]">研究热点</dt>
                <dd className="mt-1 font-serif text-2xl text-[#252522]">{researchTrendsSnapshot.hotspotCount}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[#817d76]">登记来源</dt>
                <dd className="mt-1 font-serif text-2xl text-[#252522]">{researchTrendsSnapshot.registeredSourceCount}</dd>
              </div>
            </dl>
            <Link
              href="/research/trends"
              className="mt-7 inline-flex rounded-md bg-[#2f4937] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#24392a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#41604a] focus-visible:ring-offset-2"
            >
              浏览研究热点
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {featuredResearchTrends.map((hotspot) => (
              <article key={hotspot.id} className="rounded-lg border border-black/[0.08] bg-white p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#89857d]">{hotspot.id}</p>
                <h3 className="mt-2 text-sm font-semibold leading-6 text-[#2d2d29]">{hotspot.nameZh}</h3>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#716e68]">{hotspot.summary}</p>
                {researchTrendDeepDiveHrefById[hotspot.id] ? (
                  <Link
                    href={researchTrendDeepDiveHrefById[hotspot.id]}
                    className="mt-3 inline-flex text-xs font-semibold text-[#36533e] underline decoration-[#36533e]/35 underline-offset-4"
                  >
                    查看深度研究
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
