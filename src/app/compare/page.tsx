'use client';

import { useCompare } from '@/context/CompareContext';
import Link from 'next/link';
import { X, GitCompare, Trash2 } from 'lucide-react';
import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import AdaptiveHeader from '@/components/AdaptiveHeader';

export default function ComparePage() {
  const { compareList, removeFromCompare, clearCompare } = useCompare();

  if (compareList.length === 0) {
    return (
      <div className="min-h-screen libereal-service-page flex flex-col">
        <AdaptiveHeader />
        <div className="flex-1 flex flex-col items-center justify-center">
          <GitCompare className="w-16 h-16 text-gray-300 mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">对比车是空的</h2>
          <p className="text-gray-400 mb-6">请先添加产品进行对比</p>
          <Link href="/products" className="bg-brand-500 hover:bg-brand-600 text-white px-6 py-3 rounded-lg font-medium">
            浏览产品
          </Link>
        </div>
        <SiteFooter />
        <MobileBottomNav />
      </div>
    );
  }

  const specs = [
    { key: 'brand', label: '品牌' },
    { key: 'catalogNumber', label: '货号' },
    { key: 'category', label: '分类' },
    { key: 'subcategory', label: '子分类' },
    { key: 'host', label: '宿主' },
    { key: 'target', label: '靶点' },
    { key: 'spec', label: '规格' },
    { key: 'applications', label: '应用' },
    { key: 'reactivity', label: '反应性' },
  ];

  const formatValue = (key: string, value: unknown): string => {
    if (key === 'applications' || key === 'reactivity') {
      return Array.isArray(value) ? value.join(', ') : String(value ?? '-');
    }
    return value ? String(value) : '-';
  };

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <GitCompare className="w-7 h-7 text-brand-600" />
            产品对比
          </h1>
          <button
            onClick={clearCompare}
            className="text-sm text-gray-400 hover:text-red-500 flex items-center gap-1"
          >
            <Trash2 className="w-4 h-4" /> 清空对比
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left px-4 py-3 bg-gray-50 border-b border-gray-100 w-32">
                    <span className="text-xs font-semibold text-gray-500">规格</span>
                  </th>
                  {compareList.map(product => (
                    <th key={product.id} className="px-4 py-3 border-b border-gray-100 min-w-[200px]">
                      <div className="relative">
                        <button
                          onClick={() => removeFromCompare(product.id)}
                          className="absolute -top-1 -right-1 p-1 bg-gray-100 hover:bg-red-100 rounded-full text-gray-400 hover:text-red-500"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <p className="font-semibold text-gray-900 text-sm">{product.name}</p>
                        <p className="text-xs text-gray-400 mt-1">{product.brand} · {product.catalogNumber}</p>
                        <p className="text-brand-600 font-bold mt-2">
                          {(() => {
                            // 方案③：展示价由服务端预计算（displayPrice），前端只渲染
                            const display = product.displayPrice ?? { salePrice: 0, strikethroughPrice: undefined, showGuestDiscount: false, isPromo: false, hasPrice: false };
                            if (!display.hasPrice) return '待报价';
                            return (
                              <>
                                ¥{display.salePrice.toLocaleString('zh-CN')}
                                {display.strikethroughPrice ? (
                                  <span className="ml-1.5 text-xs font-normal text-gray-400 line-through">
                                    ¥{display.strikethroughPrice.toLocaleString('zh-CN')}
                                  </span>
                                ) : null}
                              </>
                            );
                          })()}
                        </p>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {specs.map(({ key, label }) => (
                  <tr key={key}>
                    <td className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                      <span className="text-xs font-medium text-gray-500">{label}</span>
                    </td>
                    {compareList.map(product => (
                      <td key={product.id} className="px-4 py-3 border-b border-gray-100">
                        <span className="text-sm text-gray-700">
                          {formatValue(key, (product as unknown as Record<string, unknown>)[key])}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/products"
            className="text-sm text-brand-600 hover:text-brand-700"
          >
            + 添加更多产品进行对比
          </Link>
        </div>
      </main>

      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}