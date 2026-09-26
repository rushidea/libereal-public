'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ShoppingCart, X, Plus, Minus, Trash2 } from 'lucide-react';
import { useCart, getCartItemKey } from '@/context/CartContext';
import { uiSurfaces } from '@/lib/ui-surfaces';

import { getEffectiveProductPrice, isPricedProduct } from '@/lib/product-pricing';
import { toCartLines, canIncreasePromotionItem } from '@/lib/cart-promotions/detect';
import { computePromoAdjustments } from '@/lib/cart-promotions/service';

const cartIconButtonClass = `inline-flex h-10 w-10 items-center justify-center rounded-[var(--brand-border-radius)] ${uiSurfaces.textInteractive} transition-colors hover:bg-[var(--brand-color-bg-hover)] ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`;
const quantityButtonClass = `inline-flex h-8 w-8 items-center justify-center rounded-[var(--brand-border-radius-sm)] ${uiSurfaces.textInteractive} transition-colors hover:bg-[var(--brand-color-bg-hover)] ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`;
const removeButtonClass = `inline-flex h-8 w-8 items-center justify-center rounded-[var(--brand-border-radius-sm)] ${uiSurfaces.textInteractive} transition-colors hover:bg-[var(--brand-color-error-bg)] hover:text-[var(--brand-color-error-text)] ${uiSurfaces.focusRing}`;

export default function CartPopover() {
  const { items, totalItems, updateQuantity, removeItem } = useCart();
  const pricedItems = items.filter((item) => !item.isQuickOrder && isPricedProduct(item.product));
  const promotion = computePromoAdjustments(toCartLines(pricedItems));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

  return (
    <div ref={ref} className="relative z-[100]">
      {/* Cart button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative cursor-pointer ${cartIconButtonClass}`}
        aria-label="购物车"
      >
        <ShoppingCart size={22} />
        {totalItems > 0 && (
          <span className={`absolute -right-1 -top-1 flex h-5 min-h-0 w-5 items-center justify-center rounded-full border-0 px-0 text-xs font-bold leading-none ${uiSurfaces.badgeError}`}>
            {totalItems}
          </span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div data-header-popup className={`absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.panelStrong}`}>
          {/* Header */}
          <div data-header-popup-section className="flex items-center justify-between border-b border-[var(--brand-color-border)] px-4 py-3">
            <span className={`text-sm font-semibold ${uiSurfaces.titleText}`}>购物车 ({totalItems})</span>
            <button
              onClick={() => setOpen(false)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-[var(--brand-border-radius-sm)] ${uiSurfaces.textInteractive} transition-colors hover:bg-[var(--brand-color-bg-hover)] ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`}
            >
              <X size={14} />
            </button>
          </div>

          {/* Items */}
          <div data-header-popup-body className="max-h-72 overflow-y-auto">
            {items.length === 0 ? (
              <div data-header-popup-body className={`py-8 text-center text-sm ${uiSurfaces.textQuaternary}`}>
                购物车是空的
              </div>
            ) : (
              <div className="divide-y divide-[var(--brand-color-border-secondary)]">
                {items.map((item) => {

                  if (item.isQuickOrder) {
                    const i = item;
                    return (
                      <div key={i.quickId} className="px-4 py-3 flex items-start gap-3">
                        <span className={`mt-0.5 min-h-0 rounded-[var(--brand-border-radius-sm)] border-0 px-1.5 py-0.5 text-xs leading-4 ${uiSurfaces.badgeWarning}`}>急</span>
                        <div className="flex-1 min-w-0">
                          <p className={`truncate text-sm font-medium ${uiSurfaces.text}`}>{i.name}</p>
                          <p className={`mt-0.5 text-xs ${uiSurfaces.textQuaternary}`}>{i.brand} · {i.catalogNumber}</p>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-sm font-semibold text-[var(--brand-color-warning-text)]">待报价</span>
                            <div className="flex items-center gap-1">
                              <button onClick={() => updateQuantity(i.quickId, i.quantity - 1)} className={quantityButtonClass}><Minus size={12} /></button>
                              <span className="text-xs font-medium w-5 text-center">{i.quantity}</span>
                              <button onClick={() => updateQuantity(i.quickId, i.quantity + 1)} className={quantityButtonClass}><Plus size={12} /></button>
                              <button onClick={() => removeItem(i.quickId)} className={`${removeButtonClass} ml-1`}><Trash2 size={12} /></button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  } else {
                    const i = item;
                    // 方案③：展示价由服务端预计算（displayPrice），前端只渲染
                    const salePrice = getEffectiveProductPrice(i.product);
                    const lineTotal = salePrice * i.quantity - (promotion.lineDiscounts[String(pricedItems.indexOf(i))] ?? 0);
                    return (
                      <div key={getCartItemKey(i)} className="px-4 py-3 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className={`truncate text-sm font-medium ${uiSurfaces.text}`}>{i.product.name}</p>
                          <p className={`mt-0.5 text-xs ${uiSurfaces.textQuaternary}`}>{i.product.brand} · {i.product.catalogNumber}</p>
                          <div className="flex items-center justify-between mt-2">
                            <span className={`text-sm font-semibold ${uiSurfaces.textInteractive}`}>
                              {salePrice > 0 ? formatPrice(lineTotal) : '待报价'}
                            </span>
                            <div className="flex items-center gap-1">
                              <button onClick={() => updateQuantity(getCartItemKey(i), i.quantity - 1)} className={quantityButtonClass}><Minus size={12} /></button>
                              <span className="text-xs font-medium w-5 text-center">{i.quantity}</span>
                              <button disabled={!canIncreasePromotionItem(i, promotion.evals)} onClick={() => updateQuantity(getCartItemKey(i), i.quantity + 1)} className={quantityButtonClass}><Plus size={12} /></button>
                              <button onClick={() => removeItem(getCartItemKey(i))} className={`${removeButtonClass} ml-1`}><Trash2 size={12} /></button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <div data-header-popup-section className="border-t border-[var(--brand-color-border)] px-4 py-3">
              <Link
                href="/cart"
                onClick={() => setOpen(false)}
                className={`${uiSurfaces.buttonPrimary} w-full px-4`}
              >
                查看购物车
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
