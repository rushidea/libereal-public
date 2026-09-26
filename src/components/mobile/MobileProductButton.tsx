'use client';

import { useState } from 'react';
import { FlaskConical, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import BottomPopup from './BottomPopup';
import { uiSurfaces } from '@/lib/ui-surfaces';

import { productCategories } from '@/data/categories';

type MobileProductButtonProps = {
  active?: boolean;
};

export default function MobileProductButton({ active = false }: MobileProductButtonProps) {
  const [open, setOpen] = useState(false);
  const [activeSub, setActiveSub] = useState<number | null>(null);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`${uiSurfaces.mobileNavItem} ${active || open ? uiSurfaces.mobileNavItemActive : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <FlaskConical size={22} className="pointer-events-none" />
        <span>产品</span>
      </button>

      <BottomPopup isOpen={open} onClose={() => { setOpen(false); setActiveSub(null); }}>
        <div className={`flex items-center justify-between border-b px-4 py-3 ${uiSurfaces.border}`}>
          <span className={`text-sm font-semibold ${uiSurfaces.titleText}`}>产品分类</span>
          <Link
            href="/promotions"
            onClick={() => { setOpen(false); setActiveSub(null); }}
            className={`${uiSurfaces.buttonSecondary} px-3 text-xs`}
          >
            促销产品
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="flex">
            <div className="max-h-[60vh] w-1/2 overflow-y-auto border-r border-[var(--surface-border)]">
              {productCategories.map((cat, i) => (
                <div key={i} className={`relative flex items-center border-b border-[var(--surface-border)] ${activeSub === i ? 'bg-[var(--brand-color-primary-bg)]' : ''}`}>
                  <button
                    type="button"
                    onClick={() => setActiveSub(activeSub === i ? null : i)}
                    className={`min-h-[44px] flex-1 px-4 py-3 pr-11 text-left text-sm ${uiSurfaces.focusRing} ${uiSurfaces.textInteractive} ${activeSub === i ? 'font-medium' : ''}`}
                  >
                    {cat.name}
                  </button>
                  <Link
                    href={`/products?cat=${encodeURIComponent(cat.name)}`}
                    onClick={() => { setOpen(false); setActiveSub(null); }}
                    className={`absolute bottom-0 right-0 top-0 flex w-11 items-center justify-center transition-colors active:bg-[var(--brand-color-primary-bg)] active:text-[var(--brand-color-text-interactive)] ${uiSurfaces.textInteractive} ${uiSurfaces.focusRing}`}
                    aria-label={`进入${cat.name}产品页`}
                  >
                    <ChevronRight size={14} className={`transition-transform ${cat.sub.length > 0 && activeSub === i ? 'rotate-90' : ''}`} />
                  </Link>
                </div>
              ))}
            </div>

            <div className="w-1/2 overflow-y-auto max-h-[60vh]">
              {activeSub !== null && productCategories[activeSub]?.sub.length > 0 ? (
                <div className="py-2">
                  <div className={`px-4 py-2 text-xs font-medium ${uiSurfaces.textQuaternary}`}>子分类</div>
                  {productCategories[activeSub].sub.map((subItem, j) => (
                    <Link
                      key={j}
                      href={`/products?cat=${encodeURIComponent(productCategories[activeSub].name)}&sub=${encodeURIComponent(subItem.name)}`}
                      onClick={() => { setOpen(false); setActiveSub(null); }}
                      className={`block min-h-[44px] px-4 py-2.5 text-sm hover:bg-[var(--surface-hover)] hover:text-[var(--brand-color-text-interactive)] ${uiSurfaces.textInteractive} ${uiSurfaces.focusRing}`}
                    >
                      {subItem.name}
                    </Link>
                  ))}
                </div>
              ) : activeSub !== null ? (
                <Link
                  href={`/products?cat=${encodeURIComponent(productCategories[activeSub].name)}`}
                  onClick={() => { setOpen(false); setActiveSub(null); }}
                  className={`block min-h-[44px] px-4 py-3 text-sm font-medium hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing} ${uiSurfaces.textInteractive}`}
                >
                  查看全部 {productCategories[activeSub].name} →
                </Link>
              ) : (
                <div className={`flex h-full items-center justify-center text-sm ${uiSurfaces.textQuaternary}`}>
                  选择左侧分类
                </div>
              )}
            </div>
          </div>
        </div>
      </BottomPopup>
    </>
  );
}
