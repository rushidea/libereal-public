'use client';

import Image from 'next/image';
import type { Product } from '@/types/Product';
import { getProductImageAlt, getProductImageUrl } from '@/lib/productImage';
import { uiSurfaces } from '@/lib/ui-surfaces';
import ProductListRow from '@/components/ProductListRow';

type ProductListDensity = 'default' | 'promotion';

type ProductListGroupProps = {
  title: string;
  eyebrow?: string;
  products: Product[];
  imageSubcategoryOverride?: string;
  density?: ProductListDensity;
  showHeader?: boolean;
  onAddToCart: (product: Product) => void;
  onRemoveFromCart: (productId: string) => void;
  isInCart: (productId: string) => boolean;
  showFulfillment?: boolean;
  promotionAction?: { href: string; label: string };
};

export default function ProductListGroup({
  title,
  products,
  imageSubcategoryOverride,
  density = 'default',
  showHeader = true,
  onAddToCart,
  onRemoveFromCart,
  isInCart,
  showFulfillment = false,
  promotionAction,
}: ProductListGroupProps) {
  if (products.length === 0) return null;

  const sample = products[0];
  const imageUrl = getProductImageUrl({
    imageUrl: undefined,
    category: sample.category,
    subcategory: imageSubcategoryOverride ?? sample.subcategory,
  });
  const imageAlt = getProductImageAlt({
    name: title,
    category: sample.category,
    subcategory: imageSubcategoryOverride ?? sample.subcategory,
  });
  const compactPromotionList = density === 'promotion';

  return (
    <section className={`overflow-hidden rounded-[var(--brand-border-radius-lg)] ${compactPromotionList ? `border ${uiSurfaces.border} ${uiSurfaces.bgContainer}` : uiSurfaces.panelStrong}`}>
      {showHeader ? (
        <header>
          {!compactPromotionList ? (
            <div className="relative h-40 overflow-hidden sm:h-48">
              {imageUrl ? (
                <Image
                  src={imageUrl}
                  alt={imageAlt}
                  fill
                  sizes="(max-width: 1280px) 100vw, 1280px"
                  className="object-cover object-center"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-brand-100 to-brand-50" />
              )}
            </div>
          ) : null}
          <div className={`border-b ${uiSurfaces.border} bg-[var(--surface-input)] ${compactPromotionList ? 'px-4 py-3 sm:px-5 lg:px-5 lg:py-2.5' : 'px-5 py-4 sm:px-6'} backdrop-blur-sm`}>
            <div className="min-w-0">
              <h3 className={`${compactPromotionList ? 'text-base lg:text-sm' : 'text-lg sm:text-xl'} font-semibold tracking-tight ${uiSurfaces.titleText}`}>{title}</h3>
            </div>
          </div>
        </header>
      ) : null}

      <div className={`divide-y divide-[var(--surface-border)] ${compactPromotionList ? 'promotion-sku-list' : ''}`}>
        {products.map((product) => (
          <ProductListRow
            key={product.id}
            product={product}
            density={compactPromotionList ? 'promotion' : 'default'}
            showFulfillment={showFulfillment}
            onAddToCart={onAddToCart}
            onRemoveFromCart={onRemoveFromCart}
            isInCart={isInCart}
            promotionAction={promotionAction}
          />
        ))}
      </div>
    </section>
  );
}
