'use client';

import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ShoppingCart, X } from 'lucide-react';
import type { Product, ProductVariant } from '@/types/Product';
import { acquireChatwaySuppression } from '@/lib/suppress-chatway';
import { uiSurfaces } from '@/lib/ui-surfaces';

type VariantSelectModalProps = {
  product: Product;
  variants: ProductVariant[];
  mode?: 'cart' | 'quote';
  onConfirm: (variant: ProductVariant) => void;
  onClose: () => void;
};

function formatPrice(price: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(price);
}

function variantKey(variant: ProductVariant) {
  return variant.id || `${variant.catalogNumber}:${variant.spec}`;
}

export default function VariantSelectModal({
  product,
  variants,
  mode = 'cart',
  onConfirm,
  onClose,
}: VariantSelectModalProps) {
  const titleId = useId();
  const sorted = [...variants].sort((a, b) => (a.price ?? 0) - (b.price ?? 0) || a.spec.localeCompare(b.spec, 'zh'));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = sorted.find((variant) => variantKey(variant) === selectedKey) ?? null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const releaseChatway = acquireChatwaySuppression();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      releaseChatway();
    };
  }, [onClose]);

  const confirmLabel = mode === 'quote' ? '加入询价清单' : '加入购物车';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-site-overlay flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative z-10 flex max-h-[min(85vh,36rem)] w-full max-w-md flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl ${uiSurfaces.panelStrong}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--brand-color-border)] px-5 py-4">
          <div className="min-w-0">
            <p className={`text-xs font-medium ${uiSurfaces.mutedText}`}>请选择规格</p>
            <h2 id={titleId} className={`mt-1 text-base font-semibold leading-6 ${uiSurfaces.titleText}`}>
              {product.name}
            </h2>
            <p className={`mt-1 font-mono text-xs ${uiSurfaces.textSecondary}`}>{product.brand}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-full p-1.5 transition hover:bg-slate-100 ${uiSurfaces.textSecondary}`}
            aria-label="关闭对话框"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-5 py-4">
          {sorted.map((variant) => {
            const key = variantKey(variant);
            const active = selectedKey === key;
            const title = variant.spec?.trim() || '标准规格';
            // 方案③：变体价由服务端按用户态下发；非正式会员的变体无 price/displayPrice → 显示"登录查看"
            const display = variant.displayPrice;
            const priceHidden = display === undefined && variant.price === undefined;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelectedKey(key)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
                  active
                    ? 'border-brand-500 bg-brand-50 shadow-sm shadow-brand-500/10'
                    : 'border-[var(--brand-color-border)] bg-white/70 hover:border-brand-300 dark:bg-slate-100/55'
                }`}
              >
                <div className="min-w-0">
                  <p className={`break-words text-sm font-semibold ${uiSurfaces.titleText}`}>{title}</p>
                  <p className={`mt-0.5 font-mono text-xs ${uiSurfaces.mutedText}`}>{variant.catalogNumber}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-right text-sm font-semibold tabular-nums text-brand-700">
                    {priceHidden ? (
                      <span className="block text-xs font-normal">登录查看</span>
                    ) : display?.hasPrice ? (
                      <>
                        <span className="block">{formatPrice(display.salePrice)}</span>
                        {display.strikethroughPrice ? (
                          <span className={`block text-xs font-normal line-through ${uiSurfaces.textQuaternary}`}>
                            {formatPrice(display.strikethroughPrice)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      '询价'
                    )}
                  </span>
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                      active ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-transparent'
                    }`}
                  >
                    <Check size={12} strokeWidth={3} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-[var(--brand-color-border)] px-5 py-4">
          <button type="button" onClick={onClose} className={`flex-1 ${uiSurfaces.ghostPill}`}>
            取消
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              onConfirm(selected);
            }}
            className={`flex flex-[1.4] items-center justify-center gap-1.5 ${uiSurfaces.primaryButton} disabled:cursor-not-allowed disabled:opacity-45`}
          >
            <ShoppingCart size={16} />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
