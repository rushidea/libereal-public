'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Beaker,
  BookOpenText,
  Calculator,
  CircleHelp,
  Dna,
  Wrench,
  Waves,
} from 'lucide-react';
import BottomPopup from '@/components/mobile/BottomPopup';
import { supportNavigationItems, type SupportNavigationItem } from '@/data/support-navigation';
import { uiSurfaces } from '@/lib/ui-surfaces';

const supportIcons: Record<SupportNavigationItem['id'], typeof Wrench> = {
  protocols: BookOpenText,
  buffers: Beaker,
  calculators: Calculator,
  spectra: Waves,
  'cd-markers': Dna,
  faqs: CircleHelp,
  'public-tools': Wrench,
};

type MobileSupportButtonProps = {
  active?: boolean;
};

export default function MobileSupportButton({ active = false }: MobileSupportButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${uiSurfaces.mobileNavItem} ${active || open ? uiSurfaces.mobileNavItemActive : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Wrench size={22} className="pointer-events-none" />
        <span>工具</span>
      </button>

      <BottomPopup isOpen={open} onClose={() => setOpen(false)}>
        <div className={`flex items-center justify-between border-b px-4 py-3 ${uiSurfaces.border}`}>
          <span className={`text-sm font-semibold ${uiSurfaces.titleText}`}>实验与支持</span>
          <Link
            href="/support"
            onClick={() => setOpen(false)}
            className={`${uiSurfaces.buttonSecondary} px-3 text-xs`}
          >
            查看全部
          </Link>
        </div>

        <nav className="grid grid-cols-2 gap-2 px-4 pb-7 pt-3" aria-label="实验与支持菜单">
          {supportNavigationItems.map((item) => {
            const Icon = supportIcons[item.id];
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`flex min-h-[72px] items-start gap-3 p-3 text-left active:bg-[var(--brand-color-primary-bg)] ${uiSurfaces.panel} ${uiSurfaces.focusRing}`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--brand-border-radius)] bg-[var(--brand-color-primary-bg)] ${uiSurfaces.textInteractive}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-semibold ${uiSurfaces.textInteractive}`}>{item.label}</span>
                  <span className={`mt-0.5 block text-[11px] leading-4 ${uiSurfaces.textQuaternary}`}>{item.description}</span>
                </span>
              </Link>
            );
          })}
        </nav>
      </BottomPopup>
    </>
  );
}
