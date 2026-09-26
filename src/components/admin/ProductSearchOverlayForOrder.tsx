'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Package } from 'lucide-react';
import { Product } from '@/types/Product';
import { buildProductSearchQuery } from '@/lib/product-search-contract';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface ProductSearchOverlayForOrderProps {
  query: string;
  onClose: () => void;
  onAddProduct: (product: Product) => void;
}

export default function ProductSearchOverlayForOrder({ query, onClose, onAddProduct }: ProductSearchOverlayForOrderProps) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const ref = useRef<HTMLDivElement>(null);
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  const searchProducts = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/products?${buildProductSearchQuery({ keyword: q, limit: 8 })}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.products || []);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchProducts(query);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, searchProducts]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!query.trim()) return null;

  return (
    <div className={`mt-2 max-h-64 overflow-y-auto ${uiSurfaces.panelStrong} rounded-brand ${uiSurfaces.border} shadow-[var(--shadow-panel)]`}>
      {loading ? (
        <div className={`px-4 py-6 text-center text-sm ${uiSurfaces.mutedText}`}>
          搜索中...
        </div>
      ) : results.length === 0 ? (
        <div className={`px-4 py-6 text-center text-sm ${uiSurfaces.mutedText}`}>
          未找到匹配 &quot;{query}&quot; 的产品
        </div>
      ) : (
        <div className="py-1">
          {results.map(p => (
            <div 
              key={p.id} 
              className={`flex cursor-pointer items-center gap-3 border-b border-[var(--surface-border)] px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] last:border-0 ${uiSurfaces.focusRing}`}
              onClick={() => { onAddProduct(p); onClose(); }}
            >
              <div className="w-8 h-8 bg-brand-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <Package className="w-4 h-4 text-brand-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`truncate text-sm font-medium ${uiSurfaces.titleText}`}>{p.name}</p>
                <p className={`mt-0.5 text-xs ${uiSurfaces.mutedText}`}>
                  {p.brand} · {p.catalogNumber} · <span className="text-brand-600 font-medium">¥{(p.price ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span>
                </p>
              </div>
              <button
                className={`flex min-h-10 flex-shrink-0 items-center gap-1 rounded-brand px-3 py-1.5 text-xs ${uiSurfaces.primaryButton} ${uiSurfaces.focusRing}`}
                onClick={(e) => { e.stopPropagation(); onAddProduct(p); onClose(); }}
              >
                添加
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
