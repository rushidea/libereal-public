'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  researchTrendDeepDiveHrefById,
  type ResearchTrendsSnapshot,
} from '@/data/knowledge/research-trends';
import { uiSurfaces } from '@/lib/ui-surfaces';

const ALL_CATEGORIES = 'all';

export default function ResearchTrendsExplorer({ snapshot }: { snapshot: ResearchTrendsSnapshot }) {
  const [categoryId, setCategoryId] = useState(ALL_CATEGORIES);
  const [query, setQuery] = useState('');

  const categoryById = useMemo(
    () => new Map(snapshot.categories.map((category) => [category.id, category])),
    [snapshot.categories],
  );
  const visibleHotspots = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return snapshot.hotspots.filter((hotspot) => {
      if (categoryId !== ALL_CATEGORIES && hotspot.categoryId !== categoryId) return false;
      if (!normalizedQuery) return true;
      return [hotspot.nameZh, hotspot.nameEn, hotspot.summary, hotspot.trendSignal]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [categoryId, query, snapshot.hotspots]);

  return (
    <section className="border-t border-[var(--brand-color-border)] py-12 sm:py-16" aria-labelledby="trend-explorer-heading">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="font-mono text-[11px] tracking-[0.15em] text-[var(--brand-color-text-quaternary)]">研究方向</p>
          <h2 id="trend-explorer-heading" className="mt-3 font-serif text-3xl tracking-[-0.03em] text-[var(--brand-color-text)] sm:text-4xl">
            研究热点目录
          </h2>
        </div>
        <label className="block w-full sm:max-w-sm">
          <span className="sr-only">搜索研究热点</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索研究方向或关键词"
            className={`h-11 w-full rounded-md border border-[var(--brand-color-border)] bg-[var(--brand-color-bg-input)] px-4 text-sm text-[var(--brand-color-text)] outline-none placeholder:text-[var(--brand-color-text-placeholder-readable)] focus:border-[var(--brand-color-primary)] focus:ring-2 focus:ring-[var(--brand-color-focus-ring-readable)]/15 ${uiSurfaces.focusRing}`}
          />
        </label>
      </div>

      <div className="mt-7 flex gap-2 overflow-x-auto pb-2" aria-label="按研究类别筛选">
        <button
          type="button"
          onClick={() => setCategoryId(ALL_CATEGORIES)}
          aria-pressed={categoryId === ALL_CATEGORIES}
            className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${uiSurfaces.focusRing} ${
            categoryId === ALL_CATEGORIES
              ? 'border-[var(--brand-color-primary)] bg-[var(--brand-color-primary)] text-[var(--brand-color-primary-text)]'
              : 'border-[var(--brand-color-border)] bg-[var(--brand-color-bg-container)] text-[var(--brand-color-text-secondary)] hover:border-[var(--brand-color-primary-border-hover)]'
          }`}
        >
          全部
        </button>
        {snapshot.categories.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => setCategoryId(category.id)}
            aria-pressed={categoryId === category.id}
            className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors ${uiSurfaces.focusRing} ${
            categoryId === category.id
                ? 'border-[var(--brand-color-primary)] bg-[var(--brand-color-primary)] text-[var(--brand-color-primary-text)]'
                : 'border-[var(--brand-color-border)] bg-[var(--brand-color-bg-container)] text-[var(--brand-color-text-secondary)] hover:border-[var(--brand-color-primary-border-hover)]'
          }`}
        >
            {category.nameZh}
          </button>
        ))}
      </div>

      <p className="mt-5 text-sm text-[var(--brand-color-text-quaternary)]" aria-live="polite">
        显示 {visibleHotspots.length} 个研究方向
      </p>

      {visibleHotspots.length > 0 ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {visibleHotspots.map((hotspot) => {
            const category = categoryById.get(hotspot.categoryId);
            const deepDiveHref = researchTrendDeepDiveHrefById[hotspot.id];
            return (
              <article key={hotspot.id} className="flex flex-col rounded-lg border border-[var(--brand-color-border)] bg-[var(--brand-color-bg-container)] p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                  <span className="rounded-full bg-[var(--brand-color-success-bg)] px-2.5 py-1 text-[var(--brand-color-success-text)]">研究热点</span>
                  <span className="font-mono tracking-[0.08em] text-[var(--brand-color-text-quaternary)]">{hotspot.id}</span>
                </div>
                <h3 className="mt-5 text-xl font-semibold leading-7 tracking-[-0.015em] text-[var(--brand-color-text)]">{hotspot.nameZh}</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--brand-color-text-quaternary)]">{hotspot.nameEn}</p>
                <p className="mt-4 text-sm leading-7 text-[var(--brand-color-text-secondary)]">{hotspot.summary}</p>
                <div className="mt-5 border-l-2 border-[var(--brand-color-success-border)] bg-[var(--brand-color-success-bg)] px-4 py-3">
                  <p className="text-[11px] font-semibold tracking-[0.08em] text-[var(--brand-color-success-text)]">近年进展</p>
                  <p className="mt-1.5 text-sm leading-6 text-[var(--brand-color-text-secondary)]">{hotspot.trendSignal}</p>
                </div>
                <div className="mt-5 border-t border-[var(--brand-color-border)] pt-4">
                  <p className="text-xs leading-5 text-[var(--brand-color-text-quaternary)]">所属类别：{category?.nameZh}</p>
                  {deepDiveHref ? (
                    <Link
                      href={deepDiveHref}
                      className="mt-4 inline-flex text-sm font-semibold text-[var(--brand-color-text-interactive)] underline decoration-[var(--brand-color-border)] underline-offset-4"
                    >
                      阅读专题
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 rounded-lg border border-dashed border-[var(--brand-color-border)] bg-[var(--brand-color-bg-container)] px-6 py-14 text-center">
          <p className="text-sm font-semibold text-[var(--brand-color-text)]">没有符合条件的研究方向</p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setCategoryId(ALL_CATEGORIES);
            }}
            className="mt-3 text-sm font-semibold text-[var(--brand-color-text-interactive)] underline decoration-[var(--brand-color-border)] underline-offset-4"
          >
            清除筛选
          </button>
        </div>
      )}
    </section>
  );
}
