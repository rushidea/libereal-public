'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Search, X, Package, ShoppingCart } from 'lucide-react';
import { Product } from '@/types/Product';
import { buildProductSearchQuery } from '@/lib/product-search-contract';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface ProductSearchOverlayProps {
  query: string;
  onClose: () => void;
  onAddToCart: (product: Product) => void;
}

export default function ProductSearchOverlay({ query, onClose, onAddToCart }: ProductSearchOverlayProps) {
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
    /* Fixed overlay so it doesn't interfere with page layout */
    <div className={`${uiSurfaces.overlay} ${uiSurfaces.modalBackdrop}`} onClick={onClose}>
      <div
        ref={ref}
        className={`absolute left-1/2 top-[calc(var(--site-header-height)+var(--site-header-gap))] w-full max-w-2xl -translate-x-1/2 overflow-hidden ${uiSurfaces.modal} rounded-brand ${uiSurfaces.border} shadow-[var(--shadow-panel-strong)]`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--surface-border)] px-4 py-3">
          <div className={`flex items-center gap-2 text-sm ${uiSurfaces.textSecondary}`}>
            <Search className="w-4 h-4" />
            <span>产品搜索结果</span>
            <span className="text-brand-600 font-medium">{results.length}</span>
            <span className={uiSurfaces.mutedText}>· 按 Esc 关闭</span>
          </div>
          <button onClick={onClose} className={`rounded-brand p-1 ${uiSurfaces.mutedText} hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing} transition-colors`}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className={`px-4 py-8 text-center text-sm ${uiSurfaces.mutedText}`}>
            搜索中...
          </div>
        ) : results.length === 0 ? (
          <div className={`px-4 py-8 text-center text-sm ${uiSurfaces.mutedText}`}>
            未找到匹配 &quot;{query}&quot; 的产品
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto py-1">
            {results.map(p => (
              <div key={p.id} className={`flex items-center gap-3 border-b border-[var(--surface-border)] px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] last:border-0`}>
                <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Package className="w-4 h-4 text-brand-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`truncate text-sm font-medium ${uiSurfaces.titleText}`}>{p.name}</p>
                  <p className={`mt-0.5 text-xs ${uiSurfaces.mutedText}`}>
                    {p.brand} · {p.catalogNumber} · <span className="text-brand-600 font-medium">¥{(p.price ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</span>
                  </p>
                </div>
                <button
                  onClick={() => { onAddToCart(p); onClose(); }}
                  className={`flex min-h-10 flex-shrink-0 items-center gap-1.5 rounded-brand px-3 py-1.5 text-xs ${uiSurfaces.primaryButton} ${uiSurfaces.focusRing}`}
                >
                  <ShoppingCart className="w-3.5 h-3.5" /> 加入购物车
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
