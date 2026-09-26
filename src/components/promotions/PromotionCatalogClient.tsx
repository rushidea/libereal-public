'use client';

import { useMemo, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, CalendarDays, Search } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';

export type PromotionStatus = '进行中' | '即将结束';

export type PromotionCatalogCard = {
  path: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  tone: string;
  action: string;
  showBrandBadge?: boolean;
  brandLogo?: { src: string; alt: string };
  group: 'reagents' | 'culture' | 'equipment';
  brand: string;
  label: string;
  activityTypes: string[];
  scenes: string[];
  status: PromotionStatus;
  condition: string;
  offer: string;
  productCount: number | null;
  endsAt: string | null;
};

const groupLabels = {
  all: '全部活动',
  reagents: '试剂与检测',
  culture: '细胞培养与耗材',
  equipment: '仪器与低温',
} as const;

const activityTypeOptions = ['换购', '买赠活动', '组合特价', '活动价'];
const statusOptions: PromotionStatus[] = ['进行中', '即将结束'];

type PromotionFilters = {
  keyword: string;
  brand: string;
  scene: string;
  activityType: string;
  status: string;
};

const emptyFilters: PromotionFilters = { keyword: '', brand: '', scene: '', activityType: '', status: '' };

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : null;
}

function readFiltersFromSearch(search: string): PromotionFilters {
  const params = new URLSearchParams(search);
  return {
    keyword: params.get('q') ?? '',
    brand: params.get('brand') ?? '',
    scene: params.get('scene') ?? '',
    activityType: params.get('type') ?? '',
    status: params.get('status') ?? '',
  };
}

function subscribeToLocation(callback: () => void): () => void {
  window.addEventListener('popstate', callback);
  return () => window.removeEventListener('popstate', callback);
}

function getLocationSearch(): string {
  return window.location.search;
}

function getServerLocationSearch(): string {
  return '';
}

function writeFiltersToUrl(nextFilters: PromotionFilters): void {
  const params = new URLSearchParams(window.location.search);
  const entries: [string, string][] = [
    ['q', nextFilters.keyword.trim()],
    ['brand', nextFilters.brand],
    ['scene', nextFilters.scene],
    ['type', nextFilters.activityType],
    ['status', nextFilters.status],
  ];
  entries.forEach(([key, value]) => {
    if (value) params.set(key, value);
    else params.delete(key);
  });
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function statusClass(status: PromotionStatus): string {
  if (status === '即将结束') return 'bg-violet-50 text-violet-800 dark:bg-violet-100 dark:text-violet-900';
  return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-100 dark:text-emerald-900';
}

function FilterChips({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className={`mb-2 text-xs font-semibold ${uiSurfaces.textSecondary}`}>{label}</legend>
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="group" aria-label={label}>
        <button
          type="button"
          aria-pressed={!value}
          onClick={() => onChange('')}
          className={`min-h-9 shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${uiSurfaces.focusRing} ${!value ? 'border-emerald-600 bg-emerald-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50 dark:border-slate-300 dark:bg-slate-100/70 dark:text-slate-700'}`}
        >
          全部
        </button>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(value === option ? '' : option)}
            className={`min-h-9 shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${uiSurfaces.focusRing} ${value === option ? 'border-emerald-600 bg-emerald-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50 dark:border-slate-300 dark:bg-slate-100/70 dark:text-slate-700'}`}
          >
            {option}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function PromotionCardView({ promotion }: { promotion: PromotionCatalogCard }) {
  const endsAt = formatDate(promotion.endsAt);
  return (
    <article className="group overflow-hidden rounded-2xl border border-white/80 bg-white/80 shadow-sm shadow-slate-900/5 transition hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-300/70 dark:bg-slate-100/65 dark:shadow-slate-900/10">
      <Link href={promotion.path} className="block">
        <div className="relative aspect-[1.85/1] overflow-hidden bg-slate-100 dark:bg-slate-200/70">
          <Image src={promotion.image} alt={promotion.imageAlt} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover object-center transition duration-500 group-hover:scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
          {promotion.brandLogo ? (
            <span className="absolute left-4 top-4 flex h-9 max-w-[9.5rem] items-center rounded-lg bg-white/95 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
              <Image src={promotion.brandLogo.src} alt={promotion.brandLogo.alt} width={150} height={37} className="h-auto max-h-7 w-auto object-contain" />
            </span>
          ) : promotion.showBrandBadge !== false ? <span className={`absolute left-4 top-4 rounded-full px-2.5 py-1 text-xs font-semibold text-white ${promotion.tone}`}>{promotion.brand}</span> : null}
          <div className="absolute inset-x-4 bottom-4 text-white"><p className="text-xs font-medium text-white/75">{promotion.label}</p><h3 className="mt-1 text-lg font-semibold leading-snug">{promotion.title}</h3></div>
        </div>
      </Link>
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${statusClass(promotion.status)}`}>{promotion.status}</span>
          {promotion.activityTypes.map((type) => <span key={type} className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:bg-slate-200 dark:text-emerald-700">{type}</span>)}
        </div>
        <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-slate-600 dark:text-slate-600">{promotion.description}</p>
        <dl className="mt-3 space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-xs dark:border-slate-300/70 dark:bg-slate-200/45">
          <div className="flex gap-3"><dt className="w-14 shrink-0 text-slate-400">活动规则</dt><dd className="min-w-0 text-slate-700 dark:text-slate-700">{promotion.condition}</dd></div>
          <div className="flex gap-3"><dt className="w-14 shrink-0 text-slate-400">活动优惠</dt><dd className="min-w-0 text-slate-700 dark:text-slate-700">{promotion.offer}</dd></div>
          <div className="flex gap-3"><dt className="w-14 shrink-0 text-slate-400">促销商品</dt><dd className="min-w-0 text-slate-700 dark:text-slate-700">{promotion.productCount != null ? `${promotion.productCount} 款促销商品` : '进入专题页查看货号与规格'}</dd></div>
        </dl>
        <div className="mt-4 flex items-center justify-between gap-3">
          {endsAt ? <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-slate-500 dark:text-slate-600"><CalendarDays size={14} /> <span className="truncate">活动至 {endsAt}</span></span> : <span />}
          <Link href={promotion.path} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-800 active:scale-[0.98]">{promotion.action}<ArrowRight size={14} /></Link>
        </div>
      </div>
    </article>
  );
}

export default function PromotionCatalogClient({ cards }: { cards: readonly PromotionCatalogCard[] }) {
  const locationSearch = useSyncExternalStore(subscribeToLocation, getLocationSearch, getServerLocationSearch);
  const filters = useMemo(() => readFiltersFromSearch(locationSearch), [locationSearch]);
  const brandOptions = useMemo(() => [...new Set(cards.map((card) => card.brand))], [cards]);
  const sceneOptions = useMemo(() => [...new Set(cards.flatMap((card) => card.scenes))], [cards]);

  const filteredCards = useMemo(() => {
    const keyword = filters.keyword.trim().toLocaleLowerCase();
    return cards.filter((card) => {
      const matchesKeyword = !keyword || `${card.brand} ${card.title} ${card.description} ${card.condition} ${card.offer}`.toLocaleLowerCase().includes(keyword);
      return matchesKeyword
        && (!filters.brand || card.brand === filters.brand)
        && (!filters.scene || card.scenes.includes(filters.scene))
        && (!filters.activityType || card.activityTypes.includes(filters.activityType))
        && (!filters.status || card.status === filters.status);
    });
  }, [cards, filters]);

  const hasActiveFilters = Object.values(filters).some(Boolean);
  const updateFilter = <K extends keyof PromotionFilters>(key: K, value: PromotionFilters[K]) => {
    writeFiltersToUrl({ ...filters, [key]: value });
  };

  return (
    <>
      <section aria-label="活动筛选" className={`mb-8 rounded-2xl border p-4 sm:p-5 ${uiSurfaces.panel}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${uiSurfaces.textInteractive}`}>活动筛选</p>
            <h1 className={`mt-1 text-2xl font-semibold tracking-tight ${uiSurfaces.titleText}`}>促销活动</h1>
          </div>
          {hasActiveFilters ? <button type="button" onClick={() => writeFiltersToUrl(emptyFilters)} className={`${uiSurfaces.linkButton} ${uiSurfaces.focusRing} px-2 py-1 text-xs`}>清除筛选</button> : null}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(16rem,1fr)_minmax(0,2fr)]">
          <label className="block">
            <span className={`mb-2 block text-xs font-semibold ${uiSurfaces.textSecondary}`}>关键词</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden />
              <input value={filters.keyword} onChange={(event) => updateFilter('keyword', event.target.value)} placeholder="搜索品牌或活动名称" aria-label="搜索品牌或活动名称" className={`min-h-10 w-full rounded-xl pl-9 pr-3 text-sm ${uiSurfaces.input} ${uiSurfaces.focusRing}`} />
            </span>
          </label>
          <div className="space-y-3">
            <FilterChips label="品牌" value={filters.brand} options={brandOptions} onChange={(value) => updateFilter('brand', value)} />
            <FilterChips label="实验场景" value={filters.scene} options={sceneOptions} onChange={(value) => updateFilter('scene', value)} />
          </div>
        </div>
        <details className="mt-4 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-300/70 dark:bg-slate-200/35">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 dark:text-slate-700">更多筛选</summary>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <FilterChips label="活动方式" value={filters.activityType} options={activityTypeOptions} onChange={(value) => updateFilter('activityType', value)} />
            <FilterChips label="活动状态" value={filters.status} options={statusOptions} onChange={(value) => updateFilter('status', value)} />
          </div>
        </details>
        <p className={`mt-4 text-xs ${uiSurfaces.textSecondary}`} aria-live="polite">当前显示 {filteredCards.length} 项活动{hasActiveFilters ? ' · 筛选条件已同步到当前链接' : ''}</p>
      </section>

      {filteredCards.length === 0 ? (
        <section className={`rounded-2xl px-5 py-12 text-center ${uiSurfaces.panel}`}>
          <p className={`text-base font-semibold ${uiSurfaces.titleText}`}>没有符合条件的活动</p>
          <p className={`mt-2 text-sm ${uiSurfaces.textSecondary}`}>可以清除筛选，或改用品牌、活动名称和实验场景查找。</p>
          <button type="button" onClick={() => writeFiltersToUrl(emptyFilters)} className={`${uiSurfaces.buttonPrimary} mt-5 min-h-10 px-4 py-2 text-sm`}>清除筛选</button>
        </section>
      ) : (
        <div className="space-y-10">
          {(Object.keys(groupLabels) as Array<keyof typeof groupLabels>)
            .filter((group) => group !== 'all')
            .map((group) => {
              const groupCards = filteredCards.filter((promotion) => promotion.group === group);
              if (groupCards.length === 0) return null;
              return (
                <section key={group} id={group} className="scroll-mt-site-header">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className={`flex items-center gap-2 text-lg font-semibold ${uiSurfaces.titleText}`}><span className="h-5 w-1 rounded-full bg-emerald-600" />{groupLabels[group]}</h3>
                  </div>
                  <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                    {groupCards.map((promotion) => <PromotionCardView key={promotion.path} promotion={promotion} />)}
                  </div>
                </section>
              );
            })}
        </div>
      )}
    </>
  );
}
