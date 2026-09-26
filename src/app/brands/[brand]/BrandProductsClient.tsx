'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { BadgePercent, Tag, ArrowLeft, Package, ChevronDown } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import ProductCard from '@/components/ProductCard';
import QuickOrderModal from '@/components/QuickOrderModal';
import { useCart } from '@/context/CartContext';
import { Product } from '@/types/Product';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import Breadcrumb from '@/components/Breadcrumb';
import {
  getBrandDisplayName,
  getBrandInfo,
  resolveDbBrandName,
} from '@/data/brands';
import { buildProductSearchQuery } from '@/lib/product-search-contract';

const PAGE_SIZE = 12;

export default function BrandProductsClient({
  brand,
  initialProducts,
  initialTotal,
}: {
  brand: string;
  initialProducts: Product[];
  initialTotal: number;
}) {
  const brandSlug = decodeURIComponent(brand);
  const dbBrandName = resolveDbBrandName(brandSlug);
  const brandInfo = getBrandInfo(brandSlug);
  const displayName = getBrandDisplayName(brandSlug);
  const { addItem, removeItem, isInCart } = useCart();
  const [showQuickOrder, setShowQuickOrder] = useState(false);
  const [detailExpanded, setDetailExpanded] = useState(false);

  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(initialProducts.length === 0 && initialTotal === 0);

  const fetchProducts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/products?${buildProductSearchQuery({ brands: [dbBrandName], page, limit: PAGE_SIZE })}`);
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
  }, [dbBrandName, page]);

  useEffect(() => {
    const silent = page === 1 && initialProducts.length > 0;
    void fetchProducts(silent);
  }, [fetchProducts, page, initialProducts.length]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader showNav={true} />

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 pb-8">
        <Breadcrumb
          items={[
            { label: '首页', href: '/' },
            { label: '品牌中心', href: '/brands' },
            { label: displayName },
          ]}
        />

        <div className="flex items-center gap-3 mb-6">
          <Link href="/brands" className="p-2 rounded-lg hover:bg-white/50 transition-colors">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </Link>
          <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200/50">
            <Tag className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>
          </div>
        </div>

        {brandInfo && (
          <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-3xl p-6 shadow-xl shadow-black/5 mb-8">
            {brandInfo.promotion ? (
              <Link
                href={brandInfo.promotion.href}
                className="mb-4 inline-flex items-center gap-2 rounded-full border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:border-red-200 hover:bg-red-100"
              >
                <BadgePercent className="h-3.5 w-3.5" />
                {brandInfo.promotion.title}
                <span className="hidden text-red-500 sm:inline">· {brandInfo.promotion.label}</span>
              </Link>
            ) : null}
            {brandInfo.detail ? (
              <button
                onClick={() => setDetailExpanded(v => !v)}
                className="w-full text-left text-sm text-gray-600 hover:text-gray-800 flex items-start gap-2"
              >
                <span className={detailExpanded ? '' : 'line-clamp-3'}>{brandInfo.description}</span>
                <ChevronDown
                  className={`w-4 h-4 flex-shrink-0 mt-0.5 transition-transform ${
 detailExpanded ? 'rotate-180' : ''
 }`}
                />
              </button>
            ) : (
              <p className="text-sm text-gray-600">{brandInfo.description}</p>
            )}
            {brandInfo.detail ? (
              <div className="border-t border-white/30 pt-4 mt-4" hidden={!detailExpanded}>
                <div className="text-sm text-gray-600 whitespace-pre-line">{brandInfo.detail}</div>
              </div>
            ) : null}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
          </div>
        ) : products.length === 0 ? (
          <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-3xl p-12 text-center shadow-xl shadow-black/5">
            <Package className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-700 mb-2">暂无产品</h3>
            <p className="text-gray-500 mb-6">该品牌下暂无产品</p>
            <Link
              href="/products"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-500/90 backdrop-blur-sm text-white rounded-xl hover:bg-brand-600 transition-colors shadow-md"
            >
              浏览全部产品
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 min-[740px]:grid-cols-2 min-[900px]:grid-cols-3 min-[1180px]:grid-cols-4 min-[1536px]:grid-cols-5">
              {products.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onAddToCart={addItem}
                  onRemoveFromCart={removeItem}
                  isInCart={isInCart(product.id)}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 mt-8 flex-wrap">
                {page > 1 && (
                  <button
                    onClick={() => setPage(p => p - 1)}
                    className="w-10 h-10 rounded-xl text-sm font-medium bg-white/60 backdrop-blur-sm text-gray-600 border border-white/50 hover:bg-white/80 hover:border-brand-300 hover:text-brand-600 transition-all"
                  >
                    ‹
                  </button>
                )}
                <span className="px-4 py-2 text-sm text-gray-600 bg-white/40 backdrop-blur-sm rounded-xl border border-white/50">
                  第 {page} / {totalPages} 页
                </span>
                {page < totalPages && (
                  <button
                    onClick={() => setPage(p => p + 1)}
                    className="w-10 h-10 rounded-xl text-sm font-medium bg-white/60 backdrop-blur-sm text-gray-600 border border-white/50 hover:bg-white/80 hover:border-brand-300 hover:text-brand-600 transition-all"
                  >
                    ›
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <MobileBottomNav />
      <SiteFooter />
      {showQuickOrder && <QuickOrderModal onClose={() => setShowQuickOrder(false)} />}
    </div>
  );
}
