'use client';

import Link from 'next/link';
import { useState, useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import ProductCard from '@/components/ProductCard';

import QuickOrderModal from '@/components/QuickOrderModal';

import { useCart } from '@/context/CartContext';
import { Product } from '@/types/Product';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import ApplicationScenes from '@/components/home/ApplicationScenes';
import ProductHighlights from '@/components/home/ProductHighlights';
import HomeResourceServices from '@/components/home/HomeResourceServices';
import HomeCampaignHero from '@/components/home/HomeCampaignHero';
import ResearchLifeMosaic from '@/components/home/ResearchLifeMosaic';
import { uiSurfaces } from '@/lib/ui-surfaces';
import { buildProductSearchQuery } from '@/lib/product-search-contract';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import MobileAccountMenu from '@/components/mobile/MobileAccountMenu';
import { productCategories } from '@/data/categories';
import { SITE_DISPLAY_NAME, SITE_HOME_DESCRIPTION } from '@/lib/seo/site-identity';

type SortOption = 'relevance' | 'price-low' | 'price-high' | 'name';

const homeProductGridClass = 'grid grid-cols-1 gap-3 min-[740px]:grid-cols-2 min-[900px]:grid-cols-3 lg:grid-cols-5 sm:gap-5';


export default function HomeClient() {
  const [showQuickOrder, setShowQuickOrder] = useState(false);
  const [results, setResults] = useState<Product[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [mobileProductSheet, setMobileProductSheet] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const { addItem, removeItem, isInCart } = useCart();

  const handleSearch = (searchQuery: string) => {
    setHasSearched(true);
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }
    fetch(`/api/products?${buildProductSearchQuery({ keyword: searchQuery, limit: 50 })}`)
      .then(r => r.json())
      .then(data => {
        setResults(data.products || []);
      })
      .catch(() => setResults([]));
  };

  const filteredResults = useMemo(() => {
    const filtered = [...results];
    if (sortBy === 'price-low') filtered.sort((a, b) => (a.price || 0) - (b.price || 0));
    else if (sortBy === 'price-high') filtered.sort((a, b) => (b.price || 0) - (a.price || 0));
    else if (sortBy === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));
    return filtered;
  }, [results, sortBy]);

  return (
    <>
      <AdaptiveHeader
        showNav
        onSearch={handleSearch}
        showQuickOrder
        onQuickOrderToggle={() => setShowQuickOrder(true)}
      />

      {showQuickOrder && <QuickOrderModal onClose={() => setShowQuickOrder(false)} />}

      <div className={`min-h-screen ${uiSurfaces.servicePage} pb-16 lg:pb-0`}>
      <div className="relative z-0">
        <h1 className="sr-only">{SITE_DISPLAY_NAME}</h1>
        <p className="sr-only">{SITE_HOME_DESCRIPTION}</p>
        {!hasSearched ? (
        <>
          <div className="px-4 sm:px-6">
            <div className="mx-auto max-w-6xl">
              <ResearchLifeMosaic />
            </div>
          </div>
          <HomeCampaignHero />

          {/* Application Scenes Grid */}
          <ApplicationScenes />

          <HomeResourceServices />

          {/* Product Highlights - Glassmorphism Cards */}
          <ProductHighlights />
        </>
      ) : (
        <main className="flex-1 py-4 sm:py-6 px-4">
          <div className="max-w-6xl mx-auto">
            <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 mb-4 text-center">
              <h2 className="font-semibold text-gray-900 mb-1 text-base">
                {hasSearched ? '搜索结果' : '所有产品'}
              </h2>
              <div className="flex items-center justify-center gap-2">
                <span className="text-sm text-gray-500">排序:</span>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} className="text-sm border border-gray-200 rounded-lg px-2 sm:px-3 py-1.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="relevance">相关性</option>
                  <option value="price-low">价格从低到高</option>
                  <option value="price-high">价格从高到低</option>
                  <option value="name">名称 A-Z</option>
                </select>
              </div>
            </div>
            {filteredResults.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 sm:p-12 text-center">
                <Sparkles size={40} className="sm:w-12 sm:h-12 mx-auto text-gray-300 mb-4" />
                <h3 className="text-lg font-semibold text-gray-700 mb-2">未找到产品</h3>
                <p className="text-base text-gray-500 mb-6">试试输入抗体名称、货号或靶点，或调整筛选条件</p>
                <button onClick={() => { setHasSearched(false); setResults([]); }} className="px-5 sm:px-6 py-2 sm:py-2.5 bg-brand-500 text-white font-medium rounded-lg hover:bg-brand-600 transition-colors text-sm">
                  清除搜索
                </button>
              </div>
            ) : (
              <div className={homeProductGridClass}>
                {filteredResults.map((product) => (
                  <ProductCard key={product.id} product={product} onAddToCart={addItem} onRemoveFromCart={removeItem} isInCart={isInCart(product.id)} />
                ))}
              </div>
            )}
          </div>
        </main>
      )}
      </div>
      </div>

      <MobileBottomNav />

      <MobileAccountMenu
        isOpen={showAccountMenu}
        onClose={() => setShowAccountMenu(false)}
      />

      {mobileProductSheet && (
        <>
          <div className="fixed inset-0 z-site-overlay bg-black/40" onClick={() => setMobileProductSheet(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-site-overlay max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white pb-8 safe-area-inset-bottom">
            <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-4" />
            <div className="px-4 pb-2">
              <h3 className="text-xl font-bold text-gray-900 mb-4">产品分类</h3>
              <div className="grid grid-cols-2 gap-2">
                {productCategories.map((cat) => (
                  <Link key={cat.name} href={`/products?cat=${encodeURIComponent(cat.name)}`} onClick={() => setMobileProductSheet(false)} className="p-3 bg-gray-50 rounded-xl text-center text-base font-medium text-gray-700 hover:bg-brand-50 hover:text-brand-700 transition-colors">
                    {cat.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      <SiteFooter />
    </>
  );
}
