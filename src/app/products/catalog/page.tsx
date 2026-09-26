'use client';

import { useState, useEffect, useMemo, startTransition, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';

import { ChevronDown, X, Package, Filter, SlidersHorizontal, GitCompare, LayoutGrid, List, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import { useCart } from '@/context/CartContext';
import { useCompare } from '@/context/CompareContext';
import SiteFooter from '@/components/SiteFooter';

import QuickOrderModal from '@/components/QuickOrderModal';

import ProductCard from '@/components/ProductCard';
import ProductListGroup from '@/components/ProductListGroup';
import { ProductGridSkeleton } from '@/components/Skeleton';
import { groupProductsForListView } from '@/lib/product-list-groups';
import { productCategories } from '@/data/categories';
import { useTheme } from '@/components/ThemeProvider';
import { uiSurfaces } from '@/lib/ui-surfaces';
import { Product } from '@/types/Product';
import { buildProductSearchQuery } from '@/lib/product-search-contract';

type SortOption = 'relevance' | 'price-low' | 'price-high' | 'name';
type ViewMode = 'list' | 'grid';
const DEFAULT_PAGE_SIZE = 12;
const VIEW_MODE_KEY = 'products-view-mode';

function getAdaptivePageSize(width: number) {
  if (width < 640) return 8;
  if (width < 1024) return 12;
  if (width < 1440) return 16;
  return 20;
}

interface FilterOptions {
  brands: string[];
  categories: string[];
  hosts: string[];
  applications: string[];
  reactivities: string[];
  speciesReactivities: string[];
  types: string[];
  brandCounts: Record<string, number>;
  brandSubBrands: Record<string, { name: string; count: number }[]>;
  subCounts?: Record<string, number>;
}

function parseSetParam(value: string): Set<string> {
  return new Set(value.split(',').map(s => s.trim()).filter(Boolean));
}

function setToParam(set: Set<string>): string {
  return [...set].join(',');
}

function ProductsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const cat = searchParams.get('cat') ?? '';
  const sub = searchParams.get('sub') ?? '';
  const brand = searchParams.get('brand') ?? '';
  const subBrand = searchParams.get('subBrand') ?? '';
  const query = searchParams.get('q') ?? searchParams.get('keyword') ?? '';
  const typeParam = searchParams.get('type') ?? '';
  const hostParam = searchParams.get('host') ?? '';
  const applicationParam = searchParams.get('application') ?? '';
  const reactivityParam = searchParams.get('reactivity') ?? '';
  const speciesParam = searchParams.get('species') ?? '';
  const promotionParam = searchParams.get('promotion') ?? '';

  const selectedHosts = useMemo(() => parseSetParam(hostParam), [hostParam]);
  const selectedApplications = useMemo(() => parseSetParam(applicationParam), [applicationParam]);
  const selectedReactivities = useMemo(() => parseSetParam(reactivityParam), [reactivityParam]);
  const selectedSpecies = useMemo(() => parseSetParam(speciesParam), [speciesParam]);
  const selectedTypes = useMemo(() => {
    const s = new Set<string>();
    if (typeParam) s.add(typeParam);
    return s;
  }, [typeParam]);
  const selectedBrands = useMemo(() => parseSetParam(brand), [brand]);

  const { addItem, removeItem, isInCart: contextIsInCart } = useCart();
  const { compareList } = useCompare();
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const skipViewModeWrite = useRef(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const pageSizeRef = useRef(DEFAULT_PAGE_SIZE);
  const [jumpValue, setJumpValue] = useState('');
  const [showQuickOrder, setShowQuickOrder] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hoverL2Open, setHoverL2Open] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { theme, mounted, toggleTheme } = useTheme();

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    brands: [],
    categories: [],
    hosts: [],
    applications: [],
    reactivities: [],
    speciesReactivities: [],
    types: [],
    brandCounts: {},
    brandSubBrands: {},
  });

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const l1Index = useMemo(() =>
    cat ? productCategories.findIndex((c) => c.name === cat) : null,
    [cat]
  );
  const l2Index = useMemo(() => {
    if (!cat || !sub || l1Index === null) return null;
    const l1 = productCategories[l1Index];
    return l1.sub.findIndex((s) => s.name === sub);
  }, [cat, sub, l1Index]);

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    });
    router.replace(`/products/catalog?${params.toString()}`);
    setPage(1);
  }, [router, searchParams]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildProductSearchQuery({
        keyword: query,
        category: cat,
        subcategory: sub,
        productType: typeParam,
        hosts: [...selectedHosts],
        applications: [...selectedApplications],
        reactivities: [...selectedReactivities],
        speciesReactivities: [...selectedSpecies],
        promotion: promotionParam === 'true',
        brands: [...selectedBrands],
        subBrand,
        sort: sortBy,
        page,
        limit: pageSize,
      });

      const res = await fetch(`/api/products?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products);
        setTotal(data.pagination.total);
      }
    } catch (err) {
      console.error('Failed to fetch products:', err);
    } finally {
      setLoading(false);
    }
  }, [query, cat, sub, typeParam, promotionParam, subBrand, sortBy, page, pageSize, selectedHosts, selectedApplications, selectedReactivities, selectedSpecies, selectedBrands]);

  const fetchFilterOptions = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (cat) params.set('category', cat);
      if (sub) params.set('sub', sub);
      const qs = params.toString();
      const res = await fetch(`/api/products/filters${qs ? `?${qs}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setFilterOptions(data);
      }
    } catch (err) {
      console.error('Failed to fetch filter options:', err);
    }
  }, [cat, sub]);

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  useEffect(() => {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored === 'grid' || stored === 'list') {
      setViewMode(stored);
    }
  }, []);

  useEffect(() => {
    const updatePageSize = () => {
      const next = getAdaptivePageSize(window.innerWidth);
      if (pageSizeRef.current === next) return;
      pageSizeRef.current = next;
      setPage(1);
      setPageSize(next);
    };

    updatePageSize();
    window.addEventListener('resize', updatePageSize);
    return () => window.removeEventListener('resize', updatePageSize);
  }, []);

  useEffect(() => {
    if (skipViewModeWrite.current) {
      skipViewModeWrite.current = false;
      return;
    }
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    startTransition(() => {
      fetchProducts();
    });
  }, [fetchProducts]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!document.getElementById('products-nav')?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    startTransition(() => { setMenuOpen(false); });
  }, [cat, sub, typeParam]);

  // Auto-cleanup stale sub: if sub doesn't exist under currentCat (e.g. old subcategory name from
  // a prior schema version), drop the sub so the page renders correctly with the latest taxonomy.
  useEffect(() => {
    if (!cat || !sub) return;
    const subExists = productCategories
      .find((c) => c.name === cat)
      ?.sub.some((s) => s.name === sub);
    if (!subExists) {
      startTransition(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('sub');
        params.delete('type');
        router.replace(`/products/catalog?${params.toString()}`);
      });
    }
  }, [cat, sub, router, searchParams]);

  useEffect(() => {
    if (l1Index !== null) {
      setHoverL2Open(true);
    }
  }, [l1Index]);

  useEffect(() => {
    startTransition(() => { setPage(1); });
  }, [cat, sub, brand, subBrand, sortBy, query, typeParam, hostParam, applicationParam, reactivityParam, promotionParam]);

  const currentCat = useMemo(() => productCategories.find((c) => c.name === cat), [cat]);
  const currentL2 = useMemo(() => currentCat?.sub.find((s) => s.name === sub), [currentCat, sub]);
  const l3Options = currentL2?.child ?? [];

  const handleL1Click = (idx: number) => {
    const c = productCategories[idx];
    setMenuOpen(false);
    router.push(`/products/catalog?cat=${encodeURIComponent(c.name)}`);
  };
  const handleL2Click = (l1: typeof productCategories[0], l2Idx: number) => {
    const s = l1.sub[l2Idx];
    setMenuOpen(false);
    const params = new URLSearchParams();
    params.set('cat', l1.name);
    params.set('sub', s.name);
    router.push(`/products/catalog?${params.toString()}`);
  };
  const handleL3Click = (child: string) => {
    setMenuOpen(false);
    updateParams({ type: child, cat, sub });
  };

  const toggleFacet = (key: 'host' | 'application' | 'reactivity' | 'species' | 'brand' | 'type', value: string) => {
    if (key === 'type') {
      updateParams({ type: typeParam === value ? null : value });
      return;
    }
    const map = {
      host: selectedHosts,
      application: selectedApplications,
      reactivity: selectedReactivities,
      species: selectedSpecies,
      brand: selectedBrands,
    };
    const next = new Set(map[key]);
    if (next.has(value)) next.delete(value);
    else next.add(value);

    const updates: Record<string, string | null> = { [key]: setToParam(next) || null };
    if (key === 'brand' && !next.has(value)) {
      const subBrandsForBrand = filterOptions.brandSubBrands[value] ?? [];
      if (subBrand && subBrandsForBrand.some(sb => sb.name === subBrand)) {
        updates.subBrand = null;
      }
    }
    if (key === 'brand' && next.size !== 1) {
      updates.subBrand = null;
    }
    updateParams(updates);
  };

  const selectSubBrand = (parentBrand: string, name: string) => {
    if (subBrand === name && selectedBrands.has(parentBrand) && selectedBrands.size === 1) {
      updateParams({ subBrand: null });
      return;
    }
    updateParams({ brand: parentBrand, subBrand: name });
  };

  const clearAllFilters = () => {
    updateParams({
      host: null,
      application: null,
      reactivity: null,
      species: null,
      brand: null,
      subBrand: null,
      type: null,
      promotion: null,
    });
  };

  const hasActiveFilters =
    selectedHosts.size > 0 ||
    selectedApplications.size > 0 ||
    selectedReactivities.size > 0 ||
    selectedSpecies.size > 0 ||
    selectedBrands.size > 0 ||
    !!subBrand ||
    !!typeParam ||
    promotionParam === 'true';

  const activeChips = useMemo(() => {
    const chips: { label: string; key: string; value: string }[] = [];
    if (typeParam) chips.push({ label: typeParam, key: 'type', value: typeParam });
    selectedHosts.forEach(v => chips.push({ label: v, key: 'host', value: v }));
    selectedApplications.forEach(v => chips.push({ label: v, key: 'application', value: v }));
    selectedReactivities.forEach(v => chips.push({ label: v, key: 'reactivity', value: v }));
    selectedSpecies.forEach(v => chips.push({ label: v, key: 'species', value: v }));
    selectedBrands.forEach(v => chips.push({ label: v, key: 'brand', value: v }));
    if (subBrand) chips.push({ label: subBrand, key: 'subBrand', value: subBrand });
    return chips;
  }, [typeParam, selectedHosts, selectedApplications, selectedReactivities, selectedSpecies, selectedBrands, subBrand]);

  const removeChip = (key: string, value: string) => {
    if (key === 'type') {
      updateParams({ type: null });
      return;
    }
    if (key === 'cat') {
      updateParams({ cat: null, sub: null, type: null });
      return;
    }
    if (key === 'sub') {
      updateParams({ sub: null, type: null });
      return;
    }
    if (key === 'promotion') {
      updateParams({ promotion: null });
      return;
    }
    if (key === 'subBrand') {
      updateParams({ subBrand: null });
      return;
    }
    const map: Record<string, Set<string>> = {
      host: selectedHosts,
      application: selectedApplications,
      reactivity: selectedReactivities,
      species: selectedSpecies,
      brand: selectedBrands,
    };
    const next = new Set(map[key]);
    next.delete(value);
    updateParams({ [key]: setToParam(next) || null });
  };

  const catalogTitle = query
    ? `搜索 "${query}"`
    : promotionParam === 'true'
      ? '促销产品'
      : '产品目录';

  const totalPages = Math.ceil(total / pageSize);
  const pageProducts = products;

  const listGroups = useMemo(
    () => groupProductsForListView(pageProducts, sub || cat || '产品列表'),
    [pageProducts, sub, cat],
  );

  const addToCart = (product: Product) => { addItem(product); };
  const isInCart = (id: string) => contextIsInCart(id);

  const toggleCollapse = (key: string) =>
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  const subCounts = filterOptions.subCounts ?? {};

  const renderSubPills = (className: string) => {
    if (!currentCat || currentCat.sub.length === 0 || query) return null;
    return (
      <div className={`${className} min-w-0 max-w-full`}>
        <button
          onClick={() => updateParams({ sub: null, type: null })}
          className={!sub ? uiSurfaces.activePill : uiSurfaces.ghostPill}
        >
          全部
        </button>
        {currentCat.sub.map((s) => {
          const isEmpty = subCounts[s.name] === 0;
          return (
            <button
              key={s.name}
              onClick={() => updateParams({ sub: s.name, type: null })}
              className={
                sub === s.name
                  ? uiSurfaces.activePill
                  : isEmpty
                    ? uiSurfaces.disabledPill
                    : uiSurfaces.ghostPill
              }
              title={isEmpty ? '暂无产品' : undefined}
            >
              {s.name}
            </button>
          );
        })}
      </div>
    );
  };

  const renderL3Pills = (className: string) => {
    if (l3Options.length === 0 || query) return null;
    if (cat === 'ELISA试剂盒' && filterOptions.types.length > 0) return null;
    return (
      <div className={`${className} min-w-0 max-w-full`}>
        <button
          onClick={() => updateParams({ type: null })}
          className={!typeParam ? uiSurfaces.activePill : uiSurfaces.ghostPill}
        >
          全部类型
        </button>
        {l3Options.map((child) => (
          <button
            key={child}
            onClick={() => updateParams({ type: child })}
            className={typeParam === child ? uiSurfaces.activePill : uiSurfaces.ghostPill}
          >
            {child}
          </button>
        ))}
      </div>
    );
  };

  const facetSections: ReadonlyArray<{
    key: 'host' | 'type' | 'applications' | 'reactivity' | 'species';
    label: string;
    options: string[];
    selected: Set<string>;
  }> = [
    { key: 'host', label: '宿主', options: filterOptions.hosts, selected: selectedHosts },
    cat === 'ELISA试剂盒' && filterOptions.types.length > 0
      ? { key: 'type', label: '应用', options: filterOptions.types, selected: selectedTypes }
      : { key: 'applications', label: '应用', options: filterOptions.applications, selected: selectedApplications },
    { key: 'reactivity', label: '反应性', options: filterOptions.reactivities, selected: selectedReactivities },
    { key: 'species', label: '种属', options: filterOptions.speciesReactivities, selected: selectedSpecies },
  ];

  const renderFilterSections = (mobile: boolean) => (
    <>
      {facetSections.map(({ key, label, options, selected }) => {
        if (options.length === 0) return null;
        const isOpen = !collapsed[key];
        const facetKey = key === 'applications' ? 'application' : key;
        return (
          <div key={key} className={`border-b border-slate-100 dark:border-slate-300 ${mobile ? 'pb-3 mb-3' : 'pb-2 mb-2'} last:border-0 last:pb-0 last:mb-0`}>
            <button
              onClick={() => toggleCollapse(key)}
              className={`flex items-center justify-between w-full font-medium text-slate-600 hover:text-brand-600 dark:text-slate-700 dark:hover:text-brand-500 ${mobile ? 'text-sm py-1.5' : 'text-xs py-1.5'}`}
            >
              <span>{label}{selected.size > 0 && ` (${selected.size})`}</span>
              <ChevronDown size={mobile ? 14 : 12} className={`transition-transform ${isOpen ? '' : '-rotate-90'}`} />
            </button>
            {isOpen && (
              <div className={`space-y-1 mt-1 pl-1 max-h-60 overflow-y-auto ${mobile ? 'space-y-2 mt-3' : ''}`}>
                {options.map((opt) => (
                  <label key={opt} className={`flex items-start gap-2 text-slate-500 cursor-pointer hover:text-slate-700 dark:text-slate-600 dark:hover:text-slate-700 ${mobile ? 'items-center gap-3 text-sm min-h-[44px]' : 'text-xs'}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(opt)}
                      onChange={() => toggleFacet(facetKey, opt)}
                      className={`rounded border-slate-300 bg-white text-brand-500 focus:ring-brand-400 dark:border-slate-400 dark:bg-slate-100 ${mobile ? 'w-5 h-5' : 'mt-0.5'}`}
                    />
                    <span className={mobile ? '' : 'truncate'}>{opt}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {filterOptions.brands.length > 0 && (
        <div className={`border-b border-gray-100 ${mobile ? 'pb-3 mb-3' : 'pb-2 mb-2'} last:border-0`}>
          <button
            onClick={() => toggleCollapse('brand')}
            className={`flex items-center justify-between w-full font-semibold text-gray-700 hover:text-brand-600 ${mobile ? 'text-sm py-1.5' : 'text-xs py-1.5'}`}
          >
            <span>品牌{selectedBrands.size > 0 && ` (${selectedBrands.size})`}</span>
            <ChevronDown size={mobile ? 14 : 12} className={`transition-transform ${!collapsed.brand ? '' : '-rotate-90'}`} />
          </button>
          {!collapsed.brand && (
            <div className={`space-y-1 mt-1 pl-1 max-h-60 overflow-y-auto ${mobile ? 'space-y-2 mt-3' : ''}`}>
              {filterOptions.brands.map((opt) => {
                const subBrands = filterOptions.brandSubBrands[opt] ?? [];
                const showSubBrands = selectedBrands.has(opt) && subBrands.length > 0;
                return (
                  <div key={opt}>
                    <label className={`flex items-start gap-2 text-gray-600 cursor-pointer hover:text-brand-600 ${mobile ? 'items-center gap-3 text-sm min-h-[44px]' : 'text-xs'}`}>
                      <input
                        type="checkbox"
                        checked={selectedBrands.has(opt)}
                        onChange={() => toggleFacet('brand', opt)}
                        className={`rounded border-gray-300 text-brand-500 focus:ring-brand-400 ${mobile ? 'w-5 h-5' : 'mt-0.5'}`}
                      />
                      <span className={mobile ? '' : 'truncate'}>
                        {opt}
                      </span>
                    </label>
                    {showSubBrands && (
                      <div className={`ml-5 mt-1 space-y-1 border-l border-gray-200 pl-2 max-h-72 overflow-y-auto ${mobile ? 'space-y-2' : ''}`}>
                        {subBrands.map((sb) => (
                          <label
                            key={sb.name}
                            className={`flex items-start gap-2 text-gray-500 cursor-pointer hover:text-brand-600 ${mobile ? 'items-center gap-3 text-sm min-h-[40px]' : 'text-xs'}`}
                          >
                            <input
                              type="radio"
                              name={`subBrand-${opt}`}
                              checked={subBrand === sb.name && selectedBrands.has(opt)}
                              onChange={() => selectSubBrand(opt, sb.name)}
                              className={`border-gray-300 text-brand-500 focus:ring-brand-400 ${mobile ? 'w-4 h-4' : 'mt-0.5'}`}
                            />
                            <span className={mobile ? '' : 'truncate'}>
                              {sb.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
      <AdaptiveHeader
        showNav={false}
        onSearch={(q) => updateParams({ q: q || null })}
        showQuickOrder
        onQuickOrderToggle={() => setShowQuickOrder(true)}
        showProductNav
        productCategories={productCategories}
        onL1Click={handleL1Click}
        onL2Click={handleL2Click}
        onL3Click={handleL3Click}
        l1Index={l1Index}
        l2Index={l2Index}
        l3Type={typeParam}
        menuOpen={menuOpen}
        onMenuOpenChange={setMenuOpen}
        hoverL2Open={hoverL2Open}
        onHoverL2OpenChange={setHoverL2Open}
      />

      <div className={`min-h-screen pb-16 lg:pb-0 ${uiSurfaces.servicePage}`}>
        <main className="mx-auto w-full max-w-[92rem] flex-1 px-4 pb-12">

        <section className={`mb-6 rounded-[1.25rem] p-4 sm:p-5 ${uiSurfaces.toolbar}`}>
          <div className="mb-4">
            <h1 className={`text-xl font-semibold tracking-tight ${uiSurfaces.titleText}`}>
              {catalogTitle}
            </h1>
          </div>

          {/* 当前筛选 Chips —— 轻量展现 */}
          {activeChips.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {activeChips.map((chip) => (
                <button
                  key={`${chip.key}-${chip.value}`}
                  onClick={() => removeChip(chip.key, chip.value)}
                  className="inline-flex items-center gap-1 rounded-full border border-white/70 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm shadow-slate-200/40 transition hover:bg-white hover:text-slate-800 dark:border-slate-300/70 dark:bg-slate-100/64 dark:text-slate-600 dark:hover:bg-slate-100/78"
                >
                  {chip.label}
                  <X size={10} />
                </button>
              ))}
              <button onClick={clearAllFilters} className="text-[11px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-700">
                清除全部
              </button>
            </div>
          )}

          {/* 工具条:移动端抽屉 + 桌面端 pills/视图/排序/对比 */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* 左侧:抽屉按钮(移动端) + 子分类 pills(桌面端) */}
            <button
              onClick={() => setSidebarOpen(true)}
              className={`lg:hidden flex items-center gap-1.5 ${uiSurfaces.ghostPill}`}
            >
              <SlidersHorizontal size={14} />
              筛选
              {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />}
            </button>

            <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-2 lg:flex">
              {renderSubPills('contents')}
              {renderL3Pills('contents')}
            </div>

            {/* 右侧:视图切换 + 对比 + 排序 */}
            <div className="flex items-center gap-2 ml-auto">
              <div className={`flex items-center gap-0.5 rounded-full p-0.5 ${uiSurfaces.panel}`}>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-label="列表视图"
                  className={`rounded-full p-1.5 transition-colors ${
 viewMode === 'list' ? 'bg-white text-brand-600 shadow-sm dark:bg-slate-100 dark:text-brand-700' : 'text-slate-400 hover:text-slate-600 dark:text-slate-500'
 }`}
                >
                  <List size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  aria-label="卡片视图"
                  className={`rounded-full p-1.5 transition-colors ${
 viewMode === 'grid' ? 'bg-white text-brand-600 shadow-sm dark:bg-slate-100 dark:text-brand-700' : 'text-slate-400 hover:text-slate-600 dark:text-slate-500'
 }`}
                >
                  <LayoutGrid size={14} />
                </button>
              </div>
            {compareList.length >= 2 ? (
              <button
                onClick={() => router.push('/compare')}
                className="flex items-center gap-1 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-brand-600/20 transition hover:bg-brand-700 dark:bg-brand-700 dark:hover:bg-brand-600"
              >
                <GitCompare size={12} />
                对比 ({compareList.length})
              </button>
            ) : null}
            <div className="hidden sm:flex items-center gap-1.5 text-slate-500 dark:text-slate-400 text-xs">
              <span>排序</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className={`px-2 py-1 text-xs ${uiSurfaces.input}`}
              >
                <option value="relevance">相关</option>
                <option value="price-low">价格 ↑</option>
                <option value="price-high">价格 ↓</option>
                <option value="name">A-Z</option>
              </select>
            </div>
          </div>
        </div>
        </section>

        {/* 移动端筛选 pills */}
        {renderSubPills('lg:hidden flex flex-wrap gap-1.5 mb-3')}
        {renderL3Pills('lg:hidden flex flex-wrap gap-1.5 mb-3')}

        <div className="flex gap-7">
          {/* 桌面端筛选侧边栏 —— 规范设计语言 */}
          <aside className="hidden lg:block w-52 flex-shrink-0">
            <div className={`sticky top-32 rounded-[1.15rem] p-3.5 ${uiSurfaces.panelStrong}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <Filter size={12} className="text-slate-500 dark:text-slate-500" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-700">筛选</span>
                </div>
                {hasActiveFilters && (
                  <button onClick={clearAllFilters} className="text-[11px] text-slate-500 hover:text-slate-700 dark:text-slate-400">
                    清除
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {renderFilterSections(false)}
              </div>
            </div>
          </aside>

          <div className="flex-1 min-w-0">
            {loading ? (
              <ProductGridSkeleton count={pageSize} />
            ) : pageProducts.length === 0 ? (
              <div className={`rounded-2xl p-10 text-center ${uiSurfaces.panel}`}>
                <Package size={40} className="mx-auto mb-3 text-slate-300 dark:text-slate-500" />
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-700">当前筛选条件下暂无匹配产品</p>
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">尝试调整筛选条件或浏览其他分类</p>
                <Link
                  href="/products/catalog"
                  className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-700"
                >
                  查看全部产品 <ArrowRight size={14} />
                </Link>
              </div>
            ) : viewMode === 'list' ? (
              <div className="space-y-5">
                {listGroups.map((group) => (
                  <ProductListGroup
                    key={group.title}
                    title={group.title}
                    eyebrow={group.eyebrow}
                    products={group.products}
                    imageSubcategoryOverride={sub || undefined}
                    onAddToCart={addToCart}
                    onRemoveFromCart={removeItem}
                    isInCart={isInCart}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 min-[680px]:grid-cols-2 min-[960px]:grid-cols-3 min-[1220px]:grid-cols-4 min-[1500px]:grid-cols-5">
                {pageProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    imageSubcategoryOverride={sub || undefined}
                    onAddToCart={addToCart}
                    onRemoveFromCart={removeItem}
                    isInCart={isInCart(product.id)}
                  />
                ))}
              </div>
            )}

            {totalPages > 1 && (() => {
              const maxVisible = 7;
              let start = Math.max(1, page - 3);
              const end = Math.min(totalPages, start + maxVisible - 1);
              if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
              const pagesToShow: number[] = [];
              if (start > 1) { pagesToShow.push(1); if (start > 2) pagesToShow.push(-1); }
              for (let i = start; i <= end; i++) pagesToShow.push(i);
              if (end < totalPages) { if (end < totalPages - 1) pagesToShow.push(-1); pagesToShow.push(totalPages); }
              return (
                <div className="mt-9 flex flex-wrap items-center justify-center gap-2">
                  {page > 1 && (
                    <button onClick={() => setPage(p => p - 1)}
                      className={`h-10 w-10 rounded-full text-sm font-medium text-gray-600 transition hover:text-brand-600 ${uiSurfaces.panel}`}>‹</button>
                  )}
                  {page > 2 && (
                    <button onClick={() => setPage(1)}
                      className={`h-10 w-10 rounded-full text-sm font-medium text-gray-600 transition hover:text-brand-600 ${uiSurfaces.panel}`}>1</button>
                  )}
                  {pagesToShow.map((p, idx) =>
                    p === -1 ? (
                      <span key={`ellipsis-${idx}`} className="flex h-10 w-10 items-center justify-center text-gray-400">…</span>
                    ) : (
                      <button key={p} onClick={() => setPage(p)}
                        className={`h-10 w-10 rounded-full text-sm font-semibold transition ${p === page ? 'bg-brand-700 text-white shadow-[0_10px_24px_rgba(5,150,105,0.22)]' : `${uiSurfaces.panel} text-gray-600 hover:text-brand-600`}`}>
                        {p}
                      </button>
                    )
                  )}
                  {page < totalPages && (
                    <button onClick={() => setPage(p => p + 1)}
                      className={`h-10 w-10 rounded-full text-sm font-medium text-gray-600 transition hover:text-brand-600 ${uiSurfaces.panel}`}>›</button>
                  )}
                  <div className={`ml-3 flex items-center gap-1.5 rounded-full px-3 py-1.5 ${uiSurfaces.toolbar}`}>
                    <span className="text-xs text-gray-400">跳转</span>
                    <input
                      type="number"
                      min={1}
                      max={totalPages}
                      value={jumpValue}
                      onChange={(e) => setJumpValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const n = parseInt(jumpValue);
                          if (!isNaN(n) && n >= 1 && n <= totalPages) { setPage(n); setJumpValue(''); }
                        }
                      }}
                      className="h-7 w-14 border-none bg-transparent text-center text-sm text-gray-700 outline-none focus:ring-0"
                      placeholder={`1-${totalPages}`}
                    />
                  </div>
                </div>
              );
            })()}
        </div>
      </div>
      </main>

      {sidebarOpen && (
        <div className="fixed inset-0 z-site-overlay lg:hidden">
          <div className="absolute inset-0 bg-slate-900/35 backdrop-blur-[1px]" onClick={() => setSidebarOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-[1.25rem] bg-white shadow-2xl dark:bg-slate-100">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-300 dark:bg-slate-100">
              <span className="text-base font-semibold text-slate-900 dark:text-slate-700">筛选</span>
              <div className="flex items-center gap-3">
                {hasActiveFilters && (
                  <button onClick={clearAllFilters} className="text-sm text-brand-600 dark:text-brand-400 font-medium">
                    清除全部
                  </button>
                )}
                <button onClick={() => setSidebarOpen(false)} className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-200 dark:hover:bg-slate-300">
                  <X size={20} className="text-slate-500" />
                </button>
              </div>
            </div>

            {hasActiveFilters && (
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 dark:border-slate-300 dark:bg-slate-200/60">
                <div className="flex items-center gap-2 flex-wrap">
                  {activeChips.map((chip) => (
                    <button
                      key={`${chip.key}-${chip.value}`}
                      onClick={() => removeChip(chip.key, chip.value)}
                      className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-300 dark:bg-slate-100 dark:text-slate-600 dark:hover:bg-slate-200"
                    >
                      <span className="max-w-[6rem] truncate">{chip.label.split('：')[1] || chip.label}</span>
                      <X size={10} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="p-4 space-y-1">
              {renderFilterSections(true)}
            </div>
            <div className="sticky bottom-0 border-t border-slate-200 bg-white p-4 dark:border-slate-300 dark:bg-slate-100">
              <button onClick={() => setSidebarOpen(false)}
                className="w-full py-3 rounded-xl bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 dark:bg-brand-700 dark:hover:bg-brand-600 transition-colors">
                查看产品
              </button>
            </div>
          </div>
        </div>
      )}

      <MobileBottomNav />
      <SiteFooter />
      {showQuickOrder && <QuickOrderModal onClose={() => setShowQuickOrder(false)} />}
    </div>
    </>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className={`flex min-h-screen items-center justify-center text-gray-400 ${uiSurfaces.servicePage}`}>加载中...</div>}>
      <ProductsContent />
    </Suspense>
  );
}
