'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { Product, ProductVariant } from '@/types/Product';
import { useCart } from '@/context/CartContext';
import { uiSurfaces } from '@/lib/ui-surfaces';
import { getProductFulfillmentPresentation } from '@/lib/product-fulfillment';
import VariantSelectModal from '@/components/VariantSelectModal';

type ProductListRowProps = {
  product: Product;
  density?: 'default' | 'promotion';
  onAddToCart: (product: Product) => void;
  onRemoveFromCart: (productId: string) => void;
  isInCart: (productId: string) => boolean;
  showFulfillment?: boolean;
  promotionAction?: { href: string; label: string };
};

function formatPrice(price: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);
}

function toCartProduct(product: Product, variant: ProductVariant): Product {
  return {
    ...product,
    variantId: variant.id,
    catalogNumber: variant.catalogNumber,
    price: variant.price,
    spec: variant.spec,
    displayPrice: variant.displayPrice,
  };
}

export default function ProductListRow({
  product,
  density = 'default',
  onAddToCart,
  onRemoveFromCart,
  isInCart,
  showFulfillment = false,
  promotionAction,
}: ProductListRowProps) {
  const router = useRouter();
  const { addQuickOrderItem } = useCart();
  const variants = product.variants ?? [];
  const hasMultipleVariants = variants.length > 1;
  const singleVariant = variants.length === 1 ? variants[0] : null;
  const sortedVariants = [...variants].sort((a, b) => (a.price ?? 0) - (b.price ?? 0) || a.spec.localeCompare(b.spec, 'zh'));
  const [showVariantModal, setShowVariantModal] = useState(false);

  const displayCatalog = singleVariant?.catalogNumber ?? product.catalogNumber;
  const displaySpec = singleVariant?.spec ?? (hasMultipleVariants ? undefined : product.spec);
  const priceDisplay = product.displayPrice;
  const effectivePrice = priceDisplay?.salePrice ?? 0;
  const listPrice = priceDisplay?.strikethroughPrice;
  const hasPrice = Boolean(priceDisplay?.hasPrice);
  const inCart = isInCart(product.id);
  const fulfillmentProduct = singleVariant
    ? {
        ...product,
        inStock: singleVariant.inStock ?? product.inStock,
        stockQuantity: singleVariant.stockQuantity ?? product.stockQuantity,
        leadTime: singleVariant.leadTime ?? product.leadTime,
        salesUnit: singleVariant.salesUnit ?? product.salesUnit,
      }
    : product;
  const fulfillment = getProductFulfillmentPresentation(fulfillmentProduct);

  const handleQuoteRequest = (variant?: ProductVariant) => {
    const chosen = variant ?? singleVariant;
    addQuickOrderItem({
      name: product.name,
      brand: product.brand,
      catalogNumber: chosen?.catalogNumber ?? displayCatalog,
      quantity: 1,
      unit: chosen?.spec || product.spec || displaySpec || '件',
    });
    router.push('/inquiry');
  };

  const handleCart = () => {
    if (inCart) {
      onRemoveFromCart(product.id);
      return;
    }
    if (hasMultipleVariants) {
      setShowVariantModal(true);
      return;
    }
    if (!hasPrice) {
      handleQuoteRequest();
      return;
    }
    if (singleVariant) {
      onAddToCart(toCartProduct(product, singleVariant));
      return;
    }
    onAddToCart(product);
  };

  const showDiscount = !hasMultipleVariants && Boolean(listPrice && listPrice > effectivePrice);
  const discountPct = showDiscount ? Math.round((1 - effectivePrice / listPrice!) * 100) : 0;
  const isPromotionDensity = density === 'promotion';

  return (
    <article className={`group relative transition-colors hover:bg-[var(--surface-hover)] ${isPromotionDensity ? 'promotion-sku-row' : 'px-5 py-4 sm:px-6 sm:py-5'}`}>
      <div className="absolute left-0 top-1/2 h-8 w-0.5 -translate-y-1/2 rounded-[var(--brand-border-radius-pill)] bg-[var(--brand-color-primary)] opacity-0 transition-opacity group-hover:opacity-100" />

      <div className={`flex flex-col ${isPromotionDensity ? 'gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_8rem_7.75rem] lg:items-center lg:gap-4' : 'gap-4 sm:flex-row sm:items-center sm:justify-between'}`}>
        <div className="min-w-0 flex-1">
          <Link
            href={`/products/${encodeURIComponent(displayCatalog)}?brand=${encodeURIComponent(product.brand)}`}
            className={`${isPromotionDensity ? 'text-sm sm:text-[15px]' : 'text-[15px] sm:text-base'} font-medium leading-snug transition-colors group-hover:text-[var(--brand-color-text-interactive-hover)] ${uiSurfaces.text} ${uiSurfaces.focusRing}`}
          >
            {product.name}
          </Link>

          <div className={`flex flex-wrap items-center ${isPromotionDensity ? 'mt-1 gap-x-2 gap-y-1' : 'mt-2 gap-2'}`}>
            <span className={`${uiSurfaces.badge} min-h-0 px-2 py-0.5 font-mono text-[11px] tracking-wide ${uiSurfaces.textInteractive}`}>
              {displayCatalog}
            </span>
            {displaySpec ? <span className={`text-xs ${uiSurfaces.textQuaternary}`}>{displaySpec}</span> : null}
            {hasMultipleVariants ? <span className={`text-xs ${uiSurfaces.textQuaternary}`}>多规格</span> : null}
            {showDiscount ? <span className={`${uiSurfaces.badgeSuccess} min-h-0 px-2 py-0.5 text-[10px] font-semibold tracking-wide`}>省 {discountPct}%</span> : null}
          </div>
          {showFulfillment ? (
            <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]" aria-label={[fulfillment.label, fulfillment.detail].filter(Boolean).join('，')}>
              <span className={fulfillment.tone === 'success' ? 'font-semibold text-emerald-700' : fulfillment.tone === 'warning' ? 'font-semibold text-amber-700' : 'font-semibold text-red-700'}>{fulfillment.label}</span>
              {fulfillment.detail ? <span className={uiSurfaces.textQuaternary}>· {fulfillment.detail}</span> : null}
            </p>
          ) : null}
        </div>

        <div className={`${isPromotionDensity ? 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 lg:contents' : 'flex items-center justify-between gap-5 sm:justify-end sm:gap-6'}`}>
          <div className={`${isPromotionDensity ? 'text-left lg:text-right' : 'text-left sm:text-right'}`}>
            {!hasPrice ? (
              <p className={`text-sm font-medium ${uiSurfaces.textQuaternary}`}>询价</p>
            ) : (
              <>
                {promotionAction ? <p className={`mb-0.5 text-[11px] ${uiSurfaces.textSecondary}`}>原价参考</p> : null}
                <p className={`${isPromotionDensity ? 'text-base' : 'text-lg'} font-semibold tabular-nums tracking-tight ${uiSurfaces.textInteractive}`}>
                  {formatPrice(effectivePrice)}
                  {hasMultipleVariants ? <span className={`ml-1 text-xs font-medium ${uiSurfaces.textQuaternary}`}>起</span> : null}
                </p>
                {showDiscount ? <p className={`mt-0.5 text-xs tabular-nums line-through ${uiSurfaces.textQuaternary}`}>{formatPrice(listPrice!)}</p> : null}
              </>
            )}
          </div>

          {promotionAction ? (
            <Link
              href={promotionAction.href}
              className={`shrink-0 text-xs ${uiSurfaces.buttonSecondary} ${uiSurfaces.focusRing}`}
              aria-label={promotionAction.label}
            >
              {promotionAction.label}<ArrowRight size={14} className="opacity-70" />
            </Link>
          ) : <button
            type="button"
            onClick={handleCart}
            disabled={product.hazardous}
            className={`shrink-0 text-xs ${inCart ? uiSurfaces.buttonSecondary : uiSurfaces.buttonPrimary}`}
          >
            {inCart ? <><Check size={14} strokeWidth={2.5} />已加入</> : <>{hasPrice ? '订购' : '询价'}<ArrowRight size={14} className="opacity-70" /></>}
          </button>}
        </div>
      </div>

      {showVariantModal ? (
        <VariantSelectModal
          product={product}
          variants={sortedVariants}
          mode={hasPrice ? 'cart' : 'quote'}
          onClose={() => setShowVariantModal(false)}
          onConfirm={(variant) => {
            setShowVariantModal(false);
            if (!hasPrice) {
              handleQuoteRequest(variant);
              return;
            }
            onAddToCart(toCartProduct(product, variant));
          }}
        />
      ) : null}
    </article>
  );
}
