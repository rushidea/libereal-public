'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  BookOpenText,
  Calculator,
  ClipboardList,
  Dna,
  FlaskConical,
  Library,
  Microscope,
  Package,
  Sparkles,
} from 'lucide-react';

import ProductCard from '@/components/ProductCard';
import { useCart } from '@/context/CartContext';
import { protocolSummaries } from '@/data/protocols-summary';
import { scenes } from '@/data/scenes';
import { supportNavigationItems, type SupportNavigationItem } from '@/data/support-navigation';
import type { Product } from '@/types/Product';
import { uiSurfaces } from '@/lib/ui-surfaces';

type CatalogKind = 'product' | 'service' | 'data';
type CatalogFilter = 'all' | CatalogKind;

type CatalogEntry = {
  id: string;
  kind: CatalogKind;
  label: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
};

const SUPPORT_ICONS: Record<SupportNavigationItem['id'], LucideIcon> = {
  protocols: BookOpenText,
  buffers: FlaskConical,
  faqs: BookOpenText,
  calculators: Calculator,
  spectra: Sparkles,
  'cd-markers': Dna,
  'public-tools': Library,
};

const SERVICE_SUPPORT_IDS: readonly SupportNavigationItem['id'][] = [
  'buffers',
  'calculators',
  'spectra',
  'cd-markers',
];

const DATA_SUPPORT_IDS: readonly SupportNavigationItem['id'][] = [
  'protocols',
  'faqs',
  'public-tools',
];

const FILTERS: Array<{ value: CatalogFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'product', label: '产品' },
  { value: 'service', label: '服务' },
  { value: 'data', label: '资料' },
];

const kindLabels: Record<CatalogKind, string> = {
  product: '产品',
  service: '服务',
  data: '资料',
};

function supportEntries(
  ids: readonly SupportNavigationItem['id'][],
  kind: CatalogKind,
): CatalogEntry[] {
  return supportNavigationItems
    .filter((item) => ids.includes(item.id))
    .map((item) => ({
      id: `${kind}-${item.id}`,
      kind,
      label: kindLabels[kind],
      title: item.label,
      description: item.description,
      href: item.href,
      icon: SUPPORT_ICONS[item.id],
    }));
}

function buildCatalogEntries(): CatalogEntry[] {
  const productEntries: CatalogEntry[] = [
    {
      id: 'product-catalog',
      kind: 'product',
      label: '产品',
      title: '产品目录',
      description: '按品牌、类别、货号和应用检索科研产品。',
      href: '/products',
      icon: Package,
    },
    {
      id: 'product-categories',
      kind: 'product',
      label: '产品',
      title: '产品分类',
      description: '从抗体、试剂盒、耗材到设备，按实验采购入口浏览。',
      href: '/products/catalog',
      icon: Library,
    },
    {
      id: 'product-promotions',
      kind: 'product',
      label: '产品',
      title: 'Promotion engine',
      description: 'Browse products with campaign eligibility supplied by the store.',
      href: '/promotions',
      icon: Sparkles,
    },
  ];

  const serviceEntries: CatalogEntry[] = [
    ...(scenes.length > 0
      ? [{
          id: 'service-scenes',
          kind: 'service' as const,
          label: '服务',
          title: '实验场景',
          description: '按 Western Blot、ELISA、细胞培养等研究任务组织产品与方法。',
          href: '/scenes',
          icon: Microscope,
        }]
      : []),
    ...supportEntries(SERVICE_SUPPORT_IDS, 'service'),
    {
      id: 'service-inquiry',
      kind: 'service',
      label: '服务',
      title: '在线询价',
      description: '提交产品、货号或实验配置，进入现有询价流程。',
      href: '/inquiry',
      icon: ClipboardList,
    },
  ];

  const dataEntries: CatalogEntry[] = [
    ...(protocolSummaries.length > 0 ? supportEntries(['protocols'], 'data') : []),
    ...supportEntries(DATA_SUPPORT_IDS.filter((id) => id !== 'protocols'), 'data'),
    {
      id: 'data-scene-library',
      kind: 'data',
      label: '资料',
      title: '研究资料入口',
      description: '从实验方法、公共工具与常见问题继续查找资料。',
      href: '/support',
      icon: Activity,
    },
  ];

  return [...productEntries, ...serviceEntries, ...dataEntries];
}

function CatalogEntryCard({ entry }: { entry: CatalogEntry }) {
  const Icon = entry.icon;

  return (
    <Link
      href={entry.href}
      data-od-id={`home-catalog-${entry.id}`}
      className={`group flex min-h-48 min-w-0 flex-col rounded-[var(--brand-border-radius)] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md ${uiSurfaces.panel} ${uiSurfaces.focusRing}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-[var(--brand-border-radius)] bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <span className={`px-2 py-1 text-[11px] ${uiSurfaces.badge}`}>{entry.label}</span>
      </div>
      <h3 className={`mt-5 text-lg font-semibold ${uiSurfaces.titleText}`}>{entry.title}</h3>
      <p className={`mt-2 text-sm leading-6 ${uiSurfaces.mutedText}`}>{entry.description}</p>
      <span className="mt-auto inline-flex items-center gap-1 pt-5 text-sm font-semibold text-brand-700 transition group-hover:gap-2 dark:text-brand-300">
        进入入口
        <ArrowUpRight className="h-4 w-4" aria-hidden />
      </span>
    </Link>
  );
}

export default function HomeServiceCatalog() {
  const { status } = useSession();
  const { addItem, removeItem, isInCart } = useCart();
  const [activeFilter, setActiveFilter] = useState<CatalogFilter>('all');
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const catalogEntries = useMemo(buildCatalogEntries, []);

  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      try {
        const response = await fetch('/api/products/hot?limit=4');
        if (!response.ok) throw new Error('Failed to load featured products');
        const data = await response.json() as { products?: Product[] };
        if (!cancelled) setFeaturedProducts(Array.isArray(data.products) ? data.products : []);
      } catch {
        if (!cancelled) setFeaturedProducts([]);
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    }

    void loadProducts();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo<Record<CatalogFilter, number>>(() => ({
    all: catalogEntries.length,
    product: catalogEntries.filter((entry) => entry.kind === 'product').length,
    service: catalogEntries.filter((entry) => entry.kind === 'service').length,
    data: catalogEntries.filter((entry) => entry.kind === 'data').length,
  }), [catalogEntries]);

  const visibleEntries = useMemo(
    () => activeFilter === 'all'
      ? catalogEntries
      : catalogEntries.filter((entry) => entry.kind === activeFilter),
    [activeFilter, catalogEntries],
  );

  const accountHref = status === 'authenticated'
    ? '/account'
    : '/login?callbackUrl=/account';

  return (
    <section
      data-od-id="home-service-catalog"
      className="px-4 py-7 sm:px-6 sm:py-12"
      aria-labelledby="home-service-catalog-title"
    >
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.16em] text-brand-700 dark:text-brand-300">研究工作入口</p>
            <h2 id="home-service-catalog-title" className={`mt-2 text-2xl font-semibold sm:text-3xl ${uiSurfaces.titleText}`}>
              把采购、资料与支持放在同一张目录里
            </h2>
            <p className={`mt-2 max-w-2xl text-sm leading-6 sm:text-base ${uiSurfaces.mutedText}`}>
              先按入口类型筛选，再进入现有产品、场景、资料和询价页面。
            </p>
          </div>
          <Link
            href={accountHref}
            className={`${uiSurfaces.buttonGhost} inline-flex min-h-10 shrink-0 items-center gap-2 self-start px-3 sm:self-auto`}
          >
            {status === 'authenticated' ? '账户中心' : '登录后同步收藏'}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>

        <div className="mt-6 overflow-x-auto pb-1">
          <div className={`inline-flex min-w-full gap-1 rounded-[var(--brand-border-radius)] p-1 sm:min-w-0 ${uiSurfaces.toolbar}`} role="tablist" aria-label="服务目录筛选">
            {FILTERS.map((filter) => {
              const active = activeFilter === filter.value;
              return (
                <button
                  key={filter.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveFilter(filter.value)}
                  className={`inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[var(--brand-border-radius)] px-4 text-sm font-semibold transition sm:flex-none ${
                    active
                      ? 'bg-brand-700 text-white shadow-sm'
                      : `${uiSurfaces.buttonGhost} ${uiSurfaces.mutedText}`
                  } ${uiSurfaces.focusRing}`}
                >
                  <span>{filter.label}</span>
                  <span className="font-mono text-xs tabular-nums opacity-80">{counts[filter.value]}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleEntries.map((entry) => (
            <CatalogEntryCard key={entry.id} entry={entry} />
          ))}
        </div>

        {(activeFilter === 'all' || activeFilter === 'product') ? (
          <div className="mt-10 border-t border-[var(--brand-color-border)] pt-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold tracking-[0.16em] text-brand-700 dark:text-brand-300">精选产品</p>
                <h3 className={`mt-2 text-xl font-semibold ${uiSurfaces.titleText}`}>从产品目录继续采购</h3>
              </div>
              <Link href="/products" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200">
                查看全部
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>

            {productsLoading ? (
              <div className="mt-5 grid grid-cols-1 gap-3 min-[740px]:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className={`min-h-48 animate-pulse rounded-[var(--brand-border-radius)] ${uiSurfaces.panel} ${uiSurfaces.skeleton}`} />
                ))}
              </div>
            ) : featuredProducts.length > 0 ? (
              <div className="mt-5 grid grid-cols-1 gap-3 min-[740px]:grid-cols-2 lg:grid-cols-4">
                {featuredProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    onAddToCart={addItem}
                    onRemoveFromCart={removeItem}
                    isInCart={isInCart(product.id)}
                  />
                ))}
              </div>
            ) : (
              <div className={`mt-5 rounded-[var(--brand-border-radius)] p-6 text-center text-sm ${uiSurfaces.panel} ${uiSurfaces.mutedText}`}>
                暂无精选产品，请进入产品目录检索。
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
