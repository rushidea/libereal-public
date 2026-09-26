'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BookOpenText, RefreshCw } from 'lucide-react';
import {
  DISCOVERY_JOURNALS,
  type DiscoveryItem,
  type DiscoveryJournalId,
} from '@/data/discoveries';
import { uiSurfaces } from '@/lib/ui-surfaces';

type JournalFilter = 'all' | DiscoveryJournalId;

type DiscoveriesResponse = {
  discoveries?: DiscoveryItem[];
  updatedAt?: string;
};

const journalById = new Map(DISCOVERY_JOURNALS.map(journal => [journal.id, journal]));

function publicationDetails(item: DiscoveryItem): string {
  return [
    item.volume ? `Vol. ${item.volume}` : '',
    item.issue ? `No. ${item.issue}` : '',
    item.pages ? `pp. ${item.pages}` : '',
  ].filter(Boolean).join(' · ');
}

function authorsLabel(authors: string[]): string {
  if (authors.length === 0) return '';
  if (authors.length <= 5) return authors.join(', ');
  return `${authors.slice(0, 5).join(', ')} 等`;
}

function DiscoverySkeleton() {
  return (
    <div className="space-y-2" aria-label="发现内容加载中">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className={`animate-pulse rounded-lg px-5 py-6 ${uiSurfaces.panel}`}>
          <div className={`h-3 w-24 rounded ${uiSurfaces.skeleton}`} />
          <div className={`mt-4 h-5 w-5/6 rounded ${uiSurfaces.skeleton}`} />
          <div className={`mt-3 h-4 w-3/5 rounded ${uiSurfaces.skeleton}`} />
        </div>
      ))}
    </div>
  );
}

export default function DiscoveriesClient({ initialJournal }: { initialJournal?: DiscoveryJournalId }) {
  const [items, setItems] = useState<DiscoveryItem[]>([]);
  const [filter, setFilter] = useState<JournalFilter>(initialJournal ?? 'all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [requestId, setRequestId] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch('/api/discoveries?limit=30', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Discoveries returned ${response.status}`);
        return response.json() as Promise<DiscoveriesResponse>;
      })
      .then(data => setItems(Array.isArray(data.discoveries) ? data.discoveries : []))
      .catch(fetchError => {
        if ((fetchError as Error).name !== 'AbortError') setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const visibleItems = useMemo(
    () => filter === 'all' ? items : items.filter(item => item.journalId === filter),
    [filter, items]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
      <aside className="lg:sticky lg:top-24">
        <div className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1" aria-label="期刊筛选">
          <button
            type="button"
            onClick={() => setFilter('all')}
            aria-pressed={filter === 'all'}
            className={`shrink-0 rounded-brand px-4 py-3 text-left transition lg:w-full ${uiSurfaces.focusRing} ${filter === 'all' ? 'bg-brand-700 text-[var(--brand-color-text-on-primary)] shadow-[0_12px_30px_color-mix(in_srgb,var(--brand-color-primary)_18%,transparent)]' : `${uiSurfaces.panel} ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} hover:bg-[var(--surface-hover)]`}`}
          >
            <span className="block text-sm font-semibold">全部期刊</span>
          </button>
          {DISCOVERY_JOURNALS.map(journal => (
            <button
              key={journal.id}
              type="button"
              onClick={() => setFilter(journal.id)}
              aria-pressed={filter === journal.id}
              className={`shrink-0 rounded-brand px-4 py-3 text-left transition lg:w-full ${uiSurfaces.focusRing} ${filter === journal.id ? 'bg-brand-700 text-[var(--brand-color-text-on-primary)] shadow-[0_12px_30px_color-mix(in_srgb,var(--brand-color-primary)_18%,transparent)]' : `${uiSurfaces.panel} ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} hover:bg-[var(--surface-hover)]`}`}
            >
              <span className="block text-sm font-semibold">{journal.shortName}</span>
              <span className={`mt-0.5 hidden text-xs leading-5 lg:block ${filter === journal.id ? 'text-emerald-50/85' : uiSurfaces.mutedText}`}>
                {journal.name}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="min-w-0" aria-live="polite">
        {loading ? <DiscoverySkeleton /> : null}

        {!loading && error ? (
          <div className={`rounded-lg p-8 text-center ${uiSurfaces.panel}`}>
            <p className={uiSurfaces.titleText}>期刊数据暂时无法读取</p>
            <button
              type="button"
              onClick={() => setRequestId(value => value + 1)}
              className={`mt-4 ${uiSurfaces.linkButton}`}
            >
              <RefreshCw size={16} />
              重新加载
            </button>
          </div>
        ) : null}

        {!loading && !error && visibleItems.length === 0 ? (
          <div className={`rounded-lg p-8 text-center ${uiSurfaces.panel}`}>
            <BookOpenText className={`mx-auto h-8 w-8 ${uiSurfaces.textSecondary}`} />
            <p className={`mt-3 ${uiSurfaces.mutedText}`}>当前期刊暂无可展示论文</p>
          </div>
        ) : null}

        {!loading && !error && visibleItems.length > 0 ? (
          <div className="space-y-2">
            {visibleItems.map(item => {
              const details = publicationDetails(item);
              const authors = authorsLabel(item.authors);
              const journal = journalById.get(item.journalId);
              return (
                <article key={item.id} className={`group rounded-lg px-5 py-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_20px_45px_rgba(71,85,105,0.14)] sm:px-6 sm:py-6 ${uiSurfaces.panel}`}>
                  <div className="flex items-center justify-between gap-4 border-b border-[var(--surface-border)] pb-3">
                    <div className="min-w-0">
                      <p className={`truncate text-xs font-semibold ${uiSurfaces.textInteractive}`}>
                        {journal?.shortName} · {item.articleType}
                      </p>
                    </div>
                    <time dateTime={item.publishedAt} className={`shrink-0 font-mono text-xs tabular-nums ${uiSurfaces.textSecondary}`}>
                      {item.publishedAt}
                    </time>
                  </div>

                  <h2 className={`mt-4 text-lg font-semibold leading-7 text-pretty sm:text-xl sm:leading-8 ${uiSurfaces.titleText}`}>
                    {item.title}
                  </h2>
                  {item.titleEn ? (
                    <p className={`mt-1.5 line-clamp-2 text-sm leading-6 ${uiSurfaces.mutedText}`}>{item.titleEn}</p>
                  ) : null}
                  {item.summary ? (
                    <p className={`mt-3 line-clamp-3 max-w-3xl text-pretty text-sm leading-6 ${uiSurfaces.mutedText}`}>{item.summary}</p>
                  ) : null}

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className={`min-w-0 text-xs leading-5 ${uiSurfaces.textSecondary}`}>
                      {authors ? <p className="truncate">{authors}</p> : null}
                      <p className="truncate">{item.journal}{details ? ` · ${details}` : ''}</p>
                    </div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className={`inline-flex shrink-0 items-center gap-1.5 self-start text-sm font-semibold transition sm:self-auto ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`}
                    >
                      原文
                      <ArrowUpRight size={16} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );
}
