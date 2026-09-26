'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShoppingCart, X, Plus, Minus, Trash2 } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { uiSurfaces } from '@/lib/ui-surfaces';
import BottomPopup from './BottomPopup';

type MobileCartButtonProps = {
  active?: boolean;
};

export default function MobileCartButton({ active = false }: MobileCartButtonProps) {
  const { items, totalItems, updateQuantity, removeItem } = useCart();
  const [open, setOpen] = useState(false);

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`relative ${uiSurfaces.mobileNavItem} ${active || open ? uiSurfaces.mobileNavItemActive : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="购物车"
      >
        <ShoppingCart size={22} className="pointer-events-none" />
        <span>购物车</span>
        {totalItems > 0 && (
          <span className={`absolute -right-0.5 -top-0.5 flex h-5 min-h-0 w-5 min-w-[20px] items-center justify-center px-0 text-xs font-bold ${uiSurfaces.badgeError}`}>
            {totalItems > 99 ? '99+' : totalItems}
          </span>
        )}
      </button>

      <BottomPopup isOpen={open} onClose={() => setOpen(false)}>
        <div className={`flex items-center justify-between border-b px-4 py-3 ${uiSurfaces.border}`}>
          <span className={`text-sm font-semibold ${uiSurfaces.titleText}`}>购物车 ({totalItems})</span>
          <button
            onClick={() => setOpen(false)}
            className={`${uiSurfaces.buttonGhost} ${uiSurfaces.mobilePopupControl} h-11 w-11 min-h-[44px] min-w-[44px] p-0 ${uiSurfaces.focusRing}`}
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-60 overflow-y-auto">
          {items.length === 0 ? (
            <div className="py-8 text-center text-sm text-[var(--brand-color-text-quaternary)]">
              购物车是空的
            </div>
          ) : (
            <div className="divide-y divide-[var(--surface-border)]">
              {items.map((item) => {
                if (item.isQuickOrder) {
                  const i = item;
                  return (
                    <div key={i.quickId} className="flex items-start gap-3 px-4 py-3">
                      <span className={`mt-0.5 min-h-0 px-1.5 py-0.5 text-xs ${uiSurfaces.badgeWarning}`}>急</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--brand-color-text)]">{i.name}</p>
                        <p className="mt-0.5 text-xs text-[var(--brand-color-text-secondary)]">{i.brand} · {i.catalogNumber}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-sm font-semibold text-[var(--brand-color-warning)]">待报价</span>
                          <div className="flex items-center gap-2">
                            <button onClick={() => updateQuantity(i.quickId, i.quantity - 1)} className={`${uiSurfaces.buttonGhost} ${uiSurfaces.mobilePopupControl} h-11 w-11 min-h-[44px] min-w-[44px] p-0 ${uiSurfaces.focusRing}`}><Minus size={14} /></button>
                            <span className="w-8 text-center text-xs font-semibold text-[var(--brand-color-text)]">{i.quantity}</span>
                            <button onClick={() => updateQuantity(i.quickId, i.quantity + 1)} className={`${uiSurfaces.buttonGhost} ${uiSurfaces.mobilePopupControl} h-11 w-11 min-h-[44px] min-w-[44px] p-0 ${uiSurfaces.focusRing}`}><Plus size={14} /></button>
                            <button onClick={() => removeItem(i.quickId)} className={`ml-2 ${uiSurfaces.buttonGhost} ${uiSurfaces.mobilePopupDangerControl} h-11 w-11 min-h-[44px] min-w-[44px] p-0 hover:border-[var(--brand-color-error-border)] hover:bg-[var(--brand-color-error-bg)] ${uiSurfaces.focusRing}`}><Trash2 size={16} /></button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                } else {
                  const i = item as { product: { id: string; name: string; brand: string; catalogNumber: string; displayPrice?: { salePrice: number; hasPrice: boolean } }; quantity: number };
                  // 方案③：展示价由服务端预计算（displayPrice），前端只渲染
                  const display = i.product.displayPrice ?? { salePrice: 0, hasPrice: false };
                  return (
                    <div key={i.product.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--brand-color-text)]">{i.product.name}</p>
                        <p className="mt-0.5 text-xs text-[var(--brand-color-text-secondary)]">{i.product.brand} · {i.product.catalogNumber}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-sm font-semibold text-brand-600">
                            {display.hasPrice ? formatPrice(display.salePrice * i.quantity) : '待报价'}
                          </span>
                          <div className="flex items-center gap-2">
                            <button onClick={() => updateQuantity(i.product.id, i.quantity - 1)} className={`${uiSurfaces.buttonGhost} ${uiSurfaces.mobilePopupControl} h-11 w-11 min-h-[44px] min-w-[44px] p-0 ${uiSurfaces.focusRing}`}><Minus size={14} /></button>
                            <span className="w-8 text-center text-xs font-semibold text-[var(--brand-color-text)]">{i.quantity}</span>
                            <button onClick={() => updateQuantity(i.product.id, i.quantity + 1)} className={`${uiSurfaces.buttonGhost} ${uiSurfaces.mobilePopupControl} h-11 w-11 min-h-[44px] min-w-[44px] p-0 ${uiSurfaces.focusRing}`}><Plus size={14} /></button>
                            <button onClick={() => removeItem(i.product.id)} className={`ml-2 ${uiSurfaces.buttonGhost} ${uiSurfaces.mobilePopupDangerControl} h-11 w-11 min-h-[44px] min-w-[44px] p-0 hover:border-[var(--brand-color-error-border)] hover:bg-[var(--brand-color-error-bg)] ${uiSurfaces.focusRing}`}><Trash2 size={16} /></button>
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

        {items.length > 0 && (
          <div className={`border-t px-4 py-3 ${uiSurfaces.border}`}>
            <Link
              href="/cart"
              onClick={() => setOpen(false)}
              className={`${uiSurfaces.buttonPrimary} w-full text-center text-sm`}
            >
              查看购物车
            </Link>
          </div>
        )}
      </BottomPopup>
    </>
  );
}
