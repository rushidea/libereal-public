'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BadgePercent, ChevronDown, Tag } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import {
  brandDescriptions,
  brandPageHref,
  getBrandDisplayName,
  getBrandInfo,
} from '@/data/brands';

interface BrandInfo {
  name: string;
  count: number;
  subBrands: { name: string; count: number }[];
}

export default function BrandsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex justify-center items-center">
          <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      }
    >
      <BrandsPageContent />
    </Suspense>
  );
}

function BrandsPageContent() {
  const searchParams = useSearchParams();
  const highlightBrand = searchParams.get('brand');
  const [brands, setBrands] = useState<BrandInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);
  const brandRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const toggleExpand = (brandName: string) => {
    setExpandedBrand(prev => (prev === brandName ? null : brandName));
  };

  useEffect(() => {
    fetch('/api/products/filters')
      .then(r => r.json())
      .then(data => {
        const brandCounts = data.brandCounts || {};
        const brandSubBrands = data.brandSubBrands || {};

        const brandList: BrandInfo[] = (data.brands || [])
          .map((brandName: string) => ({
            name: brandName,
            count: brandCounts[brandName] || 0,
            subBrands: brandSubBrands[brandName] || [],
          }))
          .sort((a: BrandInfo, b: BrandInfo) => b.count - a.count);

        setBrands(brandList);
        setLoading(false);

        if (highlightBrand) {
          const match = brandList.find(
            b => b.name === highlightBrand || getBrandDisplayName(b.name) === highlightBrand
          );
          if (match) {
            setExpandedBrand(match.name);
            requestAnimationFrame(() => {
              brandRefs.current[match.name]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
          }
        }
      })
      .catch(() => setLoading(false));
  }, [highlightBrand]);

  return (
    <>
      <AdaptiveHeader showNav={true} />

      <div className="min-h-screen libereal-service-page pb-16 lg:pb-0">
        <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-4">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200/50">
              <Tag className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">品牌中心</h1>
              <p className="text-sm text-gray-500">共 {brands.length} 个品牌</p>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
            </div>
          ) : (
            <div className="space-y-6">
              {brands.map(brand => {
                const brandInfo = getBrandInfo(brand.name);
                const displayName = getBrandDisplayName(brand.name);
                const dbSubBrands = brand.subBrands ?? [];
                const hasDefinedSubBrands = brandInfo?.subBrands !== undefined && brandInfo.subBrands.length > 0;
                const showSubBrands = hasDefinedSubBrands || (dbSubBrands.length > 0 && brandInfo?.subBrands === undefined);
                const subBrandsToShow = hasDefinedSubBrands ? (brandInfo.subBrands ?? []) : dbSubBrands;
                const isHighlighted = highlightBrand === brand.name || highlightBrand === displayName;

                return (
                  <div
                    key={brand.name}
                    ref={el => { brandRefs.current[brand.name] = el; }}
                    className={`bg-white/70 backdrop-blur-md border rounded-3xl p-6 shadow-xl shadow-black/5 transition-all ${
 isHighlighted ? 'border-brand-400 ring-2 ring-brand-200' : 'border-white/70'
 }`}
                  >
                    <div className="mb-4">
                      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
                        <h2 className="text-lg font-bold text-gray-900">{displayName}</h2>
                        <Link
                          href={brandPageHref(brand.name)}
                          className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors"
                        >
                          浏览产品 →
                        </Link>
                      </div>
                      {brandInfo?.detail ? (
                        <button
                          onClick={() => toggleExpand(brand.name)}
                          className="w-full text-left text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1"
                        >
                          <span className={expandedBrand === brand.name ? '' : 'line-clamp-2'}>
                            {brandInfo.description}
                          </span>
                          <ChevronDown
                            className={`w-4 h-4 flex-shrink-0 transition-transform ${
 expandedBrand === brand.name ? 'rotate-180' : ''
 }`}
                          />
                        </button>
                      ) : (
                        <p className="text-sm text-gray-600">
                          {brandInfo?.description || brandDescriptions[brand.name]?.description || '专业试剂品牌'}
                        </p>
                      )}
                      {brandInfo?.promotion ? (
                        <Link
                          href={brandInfo.promotion.href}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:border-red-200 hover:bg-red-100"
                        >
                          <BadgePercent className="h-3.5 w-3.5" />
                          {brandInfo.promotion.title}
                          <span className="hidden text-red-500 sm:inline">· {brandInfo.promotion.label}</span>
                        </Link>
                      ) : null}
                    </div>

                    {expandedBrand === brand.name && brandInfo?.detail && (
                      <div className="border-t border-white/30 pt-4 mb-4">
                        <div className="text-sm text-gray-600 whitespace-pre-line">{brandInfo.detail}</div>
                      </div>
                    )}

                    {showSubBrands && (
                      <div className="border-t border-white/30 pt-4">
                        <h3 className="text-sm font-medium text-gray-500 mb-3">子品牌</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                          {subBrandsToShow.map(subBrand => {
                            const subBrandInfo = brandInfo?.subBrands?.find(
                              sb => sb.name === (typeof subBrand === 'string' ? subBrand : subBrand.name)
                            );
                            const subBrandName = typeof subBrand === 'string' ? subBrand : subBrand.name;

                            return (
                              <div
                                key={subBrandName}
                                className="bg-white/60 backdrop-blur-sm rounded-xl p-4 border border-white/50 hover:bg-white/80 hover:shadow-lg transition-all"
                              >
                                <h4 className="font-medium text-gray-900 text-sm mb-1">{subBrandName}</h4>
                                <p className="text-xs text-gray-500 line-clamp-2">
                                  {subBrandInfo?.description || '专业试剂品牌'}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </main>

        <div className="bg-white/70 backdrop-blur-md border-t border-white/70 py-4">
          <div className="max-w-7xl mx-auto px-4">
            <p className="text-xs text-gray-500 text-center">
              免责声明：本网站展示的所有品牌名称、产品名称和商标归其各自所有者所有。本网站不对这些商标主张任何权利，也与各商标所有者无关联关系。
              网站内容仅供科学研究和实验室使用，不构成商业授权或代言。
            </p>
          </div>
        </div>
      </div>

      <MobileBottomNav />
      <SiteFooter />
    </>
  );
}
