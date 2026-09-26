'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, BookOpen, Grid2X2, PackageSearch, Search, Sparkles } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import ProductCard from '@/components/ProductCard';
import QuickOrderModal from '@/components/QuickOrderModal';
import SiteFooter from '@/components/SiteFooter';
import { useCart } from '@/context/CartContext';
import { uiSurfaces } from '@/lib/ui-surfaces';
import type { Product } from '@/types/Product';
import type { ProductPromotionFeature } from '@/lib/product-promotion-center';

type ProductsHomeClientProps = {
  features: ProductPromotionFeature[];
  products: Product[];
  featuredProducts?: Product[];
};

const catalogEntries = [
  { title: '按分类浏览', description: '进入完整产品目录，按实验类型、品牌和应用条件筛选。', href: '/products/catalog', icon: Grid2X2 },
  { title: '快速订购', description: '已知货号时可直接录入清单，适合重复采购和批量询价。', href: '/products/catalog', icon: PackageSearch },
  { title: '实验资源', description: '从应用场景、实验方案和计算工具回到对应产品准备。', href: '/scenes', icon: BookOpen },
];

export default function ProductsHomeClient({ features, products, featuredProducts = [] }: ProductsHomeClientProps) {
  const { addItem, removeItem, isInCart } = useCart();
  const [showQuickOrder, setShowQuickOrder] = useState(false);

  return (
    <div className={`flex min-h-screen flex-col pb-16 lg:pb-0 ${uiSurfaces.servicePage}`}>
      <AdaptiveHeader
        showNav
        showQuickOrder
        onQuickOrderToggle={() => setShowQuickOrder(true)}
      />

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-12 px-4 pb-16 sm:px-6">
        <section className={`relative overflow-hidden rounded-[1.35rem] p-5 sm:p-8 ${uiSurfaces.panelStrong}`}>
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-brand-200/24 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute bottom-0 left-10 h-24 w-72 rounded-full bg-sky-200/18 blur-3xl" aria-hidden />
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h1 className={`text-2xl font-semibold tracking-tight [text-wrap:balance] sm:text-3xl ${uiSurfaces.titleText}`}>
                促销信息与产品入口
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/products/catalog"
                className={uiSurfaces.primaryButton}
              >
                <Search size={15} />
                进入产品目录
              </Link>
              <button
                type="button"
                onClick={() => setShowQuickOrder(true)}
                className={uiSurfaces.linkButton}
              >
                快速订购
              </button>
            </div>
          </div>
        </section>

        {features.length > 0 ? (
          <section>
            <SectionTitle title="促销专题" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <Link
                  key={feature.href}
                  href={feature.href}
                  className={`group rounded-[1.15rem] p-5 transition duration-200 hover:-translate-y-1 hover:shadow-[0_22px_54px_rgba(15,118,110,0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${uiSurfaces.panel}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold text-brand-600">{feature.label}</p>
                      <h2 className={`mt-2 text-lg font-semibold tracking-tight ${uiSurfaces.titleText}`}>{feature.title}</h2>
                      <p className={`mt-2 line-clamp-3 text-sm leading-relaxed ${uiSurfaces.mutedText}`}>{feature.description}</p>
                    </div>
                    <span className="mt-1 rounded-full bg-brand-50 p-2 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
                      <ArrowRight size={17} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <SectionTitle title="促销产品" />
            <Link href="/products/catalog?promotion=true" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
              查看目录
            </Link>
          </div>
          {products.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 min-[680px]:grid-cols-2 min-[960px]:grid-cols-3 min-[1220px]:grid-cols-4 min-[1500px]:grid-cols-5">
              {products.map((product) => (
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
            <div className={`rounded-2xl p-8 text-center text-sm ${uiSurfaces.mutedText} ${uiSurfaces.panel}`}>
              暂无正在展示的促销产品。
            </div>
          )}
        </section>

        {featuredProducts.length > 0 ? (
          <section>
            <div className="mb-4 flex items-center gap-2">
              <Sparkles size={16} className="text-brand-600" />
              <SectionTitle title="精选产品" />
            </div>
            <div className="grid grid-cols-1 gap-4 min-[680px]:grid-cols-2 min-[960px]:grid-cols-3 min-[1220px]:grid-cols-4 min-[1500px]:grid-cols-5">
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
          </section>
        ) : null}

        <section>
          <SectionTitle title="产品入口" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.15fr_1fr_0.9fr]">
            {catalogEntries.map((entry) => {
              const Icon = entry.icon;
              return (
                <Link
                  key={entry.title}
                  href={entry.href}
                  className={`group rounded-[1.15rem] p-5 transition duration-200 hover:-translate-y-1 hover:shadow-[0_22px_54px_rgba(15,118,110,0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${uiSurfaces.panel}`}
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white">
                    <Icon size={20} />
                  </div>
                  <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>{entry.title}</h2>
                  <p className={`mt-2 text-sm leading-relaxed ${uiSurfaces.mutedText}`}>{entry.description}</p>
                </Link>
              );
            })}
          </div>
        </section>
      </main>

      <SiteFooter />
      <MobileBottomNav />
      {showQuickOrder ? <QuickOrderModal onClose={() => setShowQuickOrder(false)} /> : null}
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="mb-5 flex items-center">
      <h2 className={`text-sm font-semibold tracking-tight sm:text-base ${uiSurfaces.chip}`}>
        {title}
      </h2>
    </div>
  );
}
