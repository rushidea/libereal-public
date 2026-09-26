'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Package, ShoppingCart, Check, Info, GitCompare, Heart, AlertTriangle, Flame } from 'lucide-react';
import { Product, ProductVariant } from '@/types/Product';
import { useCompare } from '@/context/CompareContext';
import { useWishlist } from '@/context/WishlistContext';
import { useCart } from '@/context/CartContext';
import { useRouter } from 'next/navigation';
import {
  getCategoryGradient,
  getDisplayBrand,
  getProductImageAlt,
  getProductImageUrl,
} from '@/lib/productImage';
import { uiSurfaces } from '@/lib/ui-surfaces';
import { getProductFulfillmentPresentation } from '@/lib/product-fulfillment';
import VariantSelectModal from '@/components/VariantSelectModal';

interface ProductCardProps {
  product: Product;
  imageSubcategoryOverride?: string;
  onAddToCart: (product: Product) => void;
  onRemoveFromCart: (productId: string) => void;
  isInCart: boolean;
  showFulfillment?: boolean;
  promotionAction?: { href: string; label: string };
}

function SpecPill({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <span className={`${uiSurfaces.badge} !min-h-0 !text-[10px] gap-0.5 border-0 px-2 py-0.5`}>
      <span className="font-medium">{label}</span>
      <span className="truncate max-w-[4.5rem]">{value}</span>
    </span>
  );
}

function toCartProduct(product: Product, variant: ProductVariant): Product {
  return {
    ...product,
    variantId: variant.id,
    catalogNumber: variant.catalogNumber,
    price: variant.price,
    spec: variant.spec,
    // 购物车展示价必须跟随所选规格，不能继续沿用商品主记录的最低规格价格。
    displayPrice: variant.displayPrice,
  };
}

export default function ProductCard({
  product,
  imageSubcategoryOverride,
  onAddToCart,
  onRemoveFromCart,
  isInCart,
  showFulfillment = false,
  promotionAction,
}: ProductCardProps) {
  const { addToCompare, isInCompare } = useCompare();
  const { isInWishlist, toggleWishlist } = useWishlist();
  const { addQuickOrderItem } = useCart();
  const router = useRouter();
  const inCompare = isInCompare(product.id);
  const inWishlist = isInWishlist(product.id);

  const variants = product.variants ?? [];
  const hasMultipleVariants = variants.length > 1;
  const singleVariant = variants.length === 1 ? variants[0] : null;
  const sortedVariants = [...variants].sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const [showVariantModal, setShowVariantModal] = useState(false);
  const [variantModalMode, setVariantModalMode] = useState<'cart' | 'quote'>('cart');

  // 方案③：展示价由服务端预计算（displayPrice），前端只渲染、不计算
  const priceDisplay = product.displayPrice;
  const displayPrice = priceDisplay?.salePrice ?? 0;
  const hasDisplayPrice = Boolean(priceDisplay?.hasPrice);
  const displayCatalogNumber = singleVariant?.catalogNumber ?? product.catalogNumber;
  const displaySpec = singleVariant?.spec ?? (hasMultipleVariants ? undefined : product.spec);
  const displayOriginalPrice = priceDisplay?.strikethroughPrice;
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

  const needsQuote = !hasDisplayPrice && !product.hazardous;
  const inQuickOrder = needsQuote && isInCart;

  const handleQuoteRequest = (variant?: ProductVariant) => {
    const chosen = variant ?? singleVariant;
    addQuickOrderItem({
      name: product.name,
      brand: product.brand,
      catalogNumber: chosen?.catalogNumber ?? displayCatalogNumber,
      quantity: 1,
      unit: chosen?.spec || product.spec || displaySpec || '件',
    });
    router.push('/inquiry');
  };

  const handleAddToCart = (variant?: ProductVariant) => {
    if (variant) {
      onAddToCart(toCartProduct(product, variant));
      return;
    }
    if (singleVariant) {
      onAddToCart(toCartProduct(product, singleVariant));
      return;
    }
    onAddToCart(product);
  };

  const openVariantModal = (mode: 'cart' | 'quote') => {
    setVariantModalMode(mode);
    setShowVariantModal(true);
  };

  const handleRemoveFromCart = () => {
    onRemoveFromCart(product.id);
  };

  const imageProduct = imageSubcategoryOverride
    ? { ...product, subcategory: imageSubcategoryOverride }
    : product;
  const imageUrl = getProductImageUrl(imageProduct);
  const imageAlt = getProductImageAlt(imageProduct);
  const categoryGradient = getCategoryGradient(product.category);
  const displayBrand = getDisplayBrand(product);

  return (
    <div className={`group relative flex h-full flex-col overflow-hidden rounded-[var(--brand-border-radius)] transition duration-200 hover:-translate-y-1 hover:border-[var(--brand-color-primary-border-hover)] ${uiSurfaces.panel}`}>
      <Link
        href={`/products/${encodeURIComponent(product.catalogNumber)}?brand=${encodeURIComponent(product.brand)}`}
        className={`relative block aspect-[4/3] overflow-hidden bg-gradient-to-br ${categoryGradient} dark:opacity-80`}
      >
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={imageAlt}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover object-center transition-transform duration-500 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Package className="h-10 w-10 text-white/40" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/34 via-slate-950/6 to-transparent" />

        {product.hazardous ? (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-[var(--brand-border-radius-pill)] bg-red-600/92 px-2 py-0.5 text-[10px] font-semibold text-white">
            <AlertTriangle className="h-3 w-3" />
            <span>暂不可订购</span>
          </div>
        ) : priceDisplay?.isPromo ? (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-[var(--brand-border-radius-pill)] bg-amber-500/92 px-2 py-0.5 text-[10px] font-semibold text-white">
            <Flame className="h-3 w-3" />
            <span>促销</span>
          </div>
        ) : null}

        {displayBrand && (
          <span className="absolute bottom-2 left-2 z-10 max-w-[calc(100%-1rem)] truncate rounded-[var(--brand-border-radius-pill)] bg-slate-950/44 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {displayBrand}
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col px-3.5 pb-3.5 pt-3">
        <Link
          href={`/products/${encodeURIComponent(product.catalogNumber)}?brand=${encodeURIComponent(product.brand)}`}
          className={`line-clamp-2 text-sm font-semibold leading-5 transition-colors hover:text-[var(--brand-color-primary-hover)] ${uiSurfaces.titleText}`}
        >
          {product.name}
        </Link>

        <p className={`mt-1 font-mono text-[11px] ${uiSurfaces.textSecondary}`}>{displayCatalogNumber}</p>
        {displaySpec ? (
          <p className={`mt-0.5 text-[11px] ${uiSurfaces.textSecondary}`}>{displaySpec}</p>
        ) : hasMultipleVariants ? (
          <p className={`mt-0.5 text-[11px] ${uiSurfaces.textSecondary}`}>多规格可选</p>
        ) : null}

        {showFulfillment ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]" aria-label={[fulfillment.label, fulfillment.detail].filter(Boolean).join('，')}>
            <span className={fulfillment.tone === 'success' ? 'font-semibold text-emerald-700' : fulfillment.tone === 'warning' ? 'font-semibold text-amber-700' : 'font-semibold text-red-700'}>{fulfillment.label}</span>
            {fulfillment.detail ? <span className={uiSurfaces.textQuaternary}>· {fulfillment.detail}</span> : null}
          </p>
        ) : null}

        {(product.target || product.host) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {product.target && <SpecPill label="靶点" value={product.target} />}
            {product.host && <SpecPill label="宿主" value={product.host} />}
          </div>
        )}

          <div className="mt-auto pt-3">
            <div className="mb-2.5 flex items-baseline gap-1.5">
              {promotionAction ? <span className={`text-[11px] ${uiSurfaces.textSecondary}`}>原价</span> : null}
              {!hasDisplayPrice ? (
                <span className="text-base font-semibold text-amber-600 dark:text-amber-500">待报价</span>
            ) : hasMultipleVariants ? (
              <>
                <span className={`text-base font-bold ${priceDisplay?.showGuestDiscount || priceDisplay?.isPromo ? 'text-[var(--brand-color-primary)]' : uiSurfaces.titleText}`}>
                  ¥{displayPrice.toLocaleString()}
                </span>
                <span className={`text-[11px] ${uiSurfaces.textSecondary}`}>起</span>
              </>
            ) : (
              <>
                <span className={`text-base font-bold ${priceDisplay?.showGuestDiscount || priceDisplay?.isPromo ? 'text-[var(--brand-color-primary)]' : uiSurfaces.titleText}`}>
                  ¥{displayPrice.toLocaleString()}
                </span>
                {displayOriginalPrice && displayOriginalPrice > displayPrice ? (
                  <span className={`text-xs line-through ${uiSurfaces.textQuaternary}`}>
                    ¥{displayOriginalPrice.toLocaleString()}
                  </span>
                ) : null}
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {promotionAction ? (
              <Link
                href={promotionAction.href}
                className={`ml-auto flex items-center gap-1 rounded-[var(--brand-border-radius-pill)] px-3 py-1.5 text-xs font-semibold ${uiSurfaces.buttonSecondary} ${uiSurfaces.focusRing}`}
                aria-label={promotionAction.label}
              >
                <span>{promotionAction.label}</span>
                <ShoppingCart className="h-3.5 w-3.5" />
              </Link>
            ) : <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (inCompare) {
                  router.push('/compare');
                } else {
                  addToCompare(product);
                }
              }}
              className={`flex items-center gap-1 rounded-[var(--brand-border-radius-pill)] border px-2.5 py-1.5 text-xs font-medium transition-colors ${uiSurfaces.focusRing} ${
                inCompare
                  ? 'border-[var(--brand-color-primary-border)] bg-[var(--brand-color-primary-bg)] text-[var(--brand-color-primary)]'
                  : 'border-[var(--brand-color-border)] text-[var(--brand-color-text-secondary)] hover:border-[var(--brand-color-primary-border-hover)] hover:text-[var(--brand-color-primary-hover)]'
              }`}
              aria-label={inCompare ? '已在对比中，点击查看' : '加入对比'}
              title={inCompare ? '已在对比中' : '加入对比'}
            >
              <GitCompare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">对比</span>
            </button>}

            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleWishlist(product);
              }}
              className={`flex items-center gap-1 rounded-[var(--brand-border-radius-pill)] border px-2.5 py-1.5 text-xs font-medium transition-colors ${uiSurfaces.focusRing} ${
                inWishlist
                  ? 'border-pink-300 bg-pink-50 text-pink-600 dark:border-pink-200 dark:bg-pink-50/80 dark:text-pink-700'
                  : 'border-[var(--brand-color-border)] text-[var(--brand-color-text-secondary)] hover:border-pink-300 hover:text-pink-500 dark:hover:border-pink-200 dark:hover:text-pink-300'
              }`}
              aria-label={inWishlist ? '移除心愿单' : '加入心愿单'}
              title={inWishlist ? '移除心愿单' : '加入心愿单'}
            >
              <Heart className={`h-3.5 w-3.5 ${inWishlist ? 'fill-current' : ''}`} />
              <span className="hidden sm:inline">收藏</span>
            </button>

            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (needsQuote) {
                  if (inQuickOrder) {
                    router.push('/inquiry');
                    return;
                  }
                  if (hasMultipleVariants) {
                    openVariantModal('quote');
                    return;
                  }
                  handleQuoteRequest();
                  return;
                }
                if (isInCart) {
                  handleRemoveFromCart();
                  return;
                }
                if (hasMultipleVariants) {
                  openVariantModal('cart');
                  return;
                }
                handleAddToCart();
              }}
              disabled={!product.inStock || product.hazardous}
              className={`ml-auto flex items-center gap-1 rounded-[var(--brand-border-radius-pill)] px-3 py-1.5 text-xs font-semibold transition-all hover:-translate-y-px active:translate-y-0 ${
                isInCart || inQuickOrder
                  ? 'bg-[var(--brand-color-primary)] text-[var(--brand-color-primary-text)] hover:bg-[var(--brand-color-primary-hover)]'
                : needsQuote
                    ? 'bg-amber-500 text-white hover:bg-amber-600'
                    : product.inStock
                      ? 'bg-[var(--brand-color-primary)] text-[var(--brand-color-primary-text)] hover:bg-[var(--brand-color-primary-hover)]'
                      : 'cursor-not-allowed bg-[var(--brand-color-bg-disabled)] text-[var(--brand-color-text-placeholder)]'
              }`}
              aria-label={isInCart ? '已加入购物车' : product.hazardous ? '不可订购' : needsQuote ? '加入询价清单' : '加入购物车'}
              title={isInCart ? '已加入购物车' : product.hazardous ? '危险化学品暂不可订购' : needsQuote ? '加入询价清单' : '加入购物车'}
            >
              {needsQuote ? (
                <span className="px-1">询价</span>
              ) : isInCart ? (
                <><Check className="h-3.5 w-3.5" /><span>已加入</span></>
              ) : (
                <><ShoppingCart className="h-3.5 w-3.5" /><span className="hidden sm:inline">加入购物车</span></>
              )}
            </button>
          </div>

          {product.hazardous && product.inStock && (
            <p className="mt-1.5 flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
              <Info className="h-3 w-3 flex-shrink-0" />
              危险化学品暂不可线上订购，请联系客服
            </p>
          )}
        </div>
      </div>

      {showVariantModal ? (
        <VariantSelectModal
          product={product}
          variants={sortedVariants}
          mode={variantModalMode}
          onClose={() => setShowVariantModal(false)}
          onConfirm={(variant) => {
            setShowVariantModal(false);
            if (variantModalMode === 'quote') {
              handleQuoteRequest(variant);
            } else {
              handleAddToCart(variant);
            }
          }}
        />
      ) : null}
    </div>
  );
}
