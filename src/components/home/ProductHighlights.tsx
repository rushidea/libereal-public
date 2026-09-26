'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import type { Product } from '@/types/Product';
import { getCategoryGradient, getProductImageAlt, getProductImageUrl } from '@/lib/productImage';
import HomeSectionHeader from '@/components/home/HomeSectionHeader';
import { uiSurfaces } from '@/lib/ui-surfaces';

type HotProduct = Product;

const productGridClass = 'grid grid-cols-1 gap-3 min-[740px]:grid-cols-2 min-[900px]:grid-cols-3 lg:grid-cols-5 sm:gap-5';

function hotProductVisibilityClass(index: number) {
  if (index < 5) return '';
  return 'hidden min-[740px]:block lg:hidden';
}

export default function ProductHighlights() {
  const [products, setProducts] = useState<HotProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/products/hot?limit=6')
      .then((res) => res.json())
      .then((data) => {
        setProducts(data.products || []);
      })
      .catch(() => {
        setProducts([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <section className="py-6 sm:py-10 px-4">
      <div className="max-w-6xl mx-auto">
        <HomeSectionHeader
          title="热门产品"
          href="/products"
          linkLabel="查看全部"
        />
        <div className={productGridClass}>
          {loading ? Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`grid min-h-32 grid-cols-[7.25rem_minmax(0,1fr)] overflow-hidden rounded-lg animate-pulse sm:block ${uiSurfaces.panel} ${hotProductVisibilityClass(i)}`}>
              <div className={`sm:h-36 ${uiSurfaces.skeleton}`} />
              <div className="space-y-3 p-3 sm:p-4">
                <div className={`h-5 w-20 rounded-full ${uiSurfaces.skeleton}`} />
                <div className={`h-5 w-full rounded ${uiSurfaces.skeleton}`} />
                <div className={`h-4 w-28 rounded ${uiSurfaces.skeleton}`} />
              </div>
            </div>
          )) : products.length === 0 ? (
            <p className={`col-span-full py-8 text-center ${uiSurfaces.mutedText}`}>暂无热门产品</p>
          ) : products.map((p, index) => {
            const category = p.category || '新产品';
            const imgPath = getProductImageUrl(p);
            const imageAlt = getProductImageAlt(p);
            const tags = [
              ...(p.applications || []),
              p.subcategory,
              p.brand,
            ].filter(Boolean).slice(0, 2);
            return (
                <Link
                  key={p.id}
                  href={`/products/${encodeURIComponent(p.catalogNumber)}?brand=${encodeURIComponent(p.brand)}`}
                  className={`group grid min-h-32 grid-cols-[7.25rem_minmax(0,1fr)] overflow-hidden rounded-brand transition hover:shadow-md sm:flex sm:h-full sm:flex-col ${uiSurfaces.panel} ${uiSurfaces.focusRing} ${hotProductVisibilityClass(index)}`}
                >
                <div
                  className={`relative min-h-32 w-full flex-shrink-0 overflow-hidden bg-gradient-to-br sm:aspect-[4/3] sm:min-h-0 ${getCategoryGradient(p.category)} dark:opacity-80`}
                >
                  {imgPath ? (
                    <Image
                      src={imgPath}
                      alt={imageAlt}
                      fill
                      sizes="(max-width: 639px) 116px, (max-width: 1024px) 50vw, 25vw"
                      className="object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Package className="h-10 w-10 text-white/40" />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-black/5 to-transparent" />
                  {tags.length > 0 ? (
                    <div className="absolute right-2 top-2 z-10 flex gap-1">
                      {tags.map((tag, index) => (
                        <span
                          key={String(tag)}
                          className={`${index === 0 ? 'bg-brand-500/90' : 'hidden bg-violet-500/90 sm:inline'} max-w-16 truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm backdrop-blur-sm`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col flex-1 p-3">
                  <p className={`mb-0.5 truncate text-[11px] font-medium ${uiSurfaces.mutedText}`}>
                    {category}
                  </p>
                  <p className={`mb-1 line-clamp-3 text-sm font-semibold leading-snug sm:line-clamp-2 ${uiSurfaces.titleText}`}>{p.name}</p>
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <p className={`truncate font-mono text-[11px] ${uiSurfaces.textQuaternary}`}>货号：{p.catalogNumber}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
