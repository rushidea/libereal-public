'use client';

import { LayoutGrid, List } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';

export type PromotionViewMode = 'list' | 'grid';

type PromotionViewToggleProps = {
  value: PromotionViewMode;
  onChange: (value: PromotionViewMode) => void;
};

const viewLabels: Record<PromotionViewMode, string> = {
  list: '列表展示',
  grid: '卡片展示',
};

export default function PromotionViewToggle({ value, onChange }: PromotionViewToggleProps) {
  return (
    <div role="radiogroup" aria-label="产品展示方式" className={`flex items-center gap-0.5 rounded-full p-0.5 ${uiSurfaces.panel}`}>
        <button
          type="button"
          role="radio"
          aria-checked={value === 'grid'}
          aria-label={viewLabels.grid}
          title={viewLabels.grid}
          onClick={() => onChange('grid')}
          className={`rounded-full p-1.5 transition-colors ${uiSurfaces.focusRing} ${
            value === 'grid'
              ? 'bg-white text-brand-600 shadow-sm dark:bg-slate-100 dark:text-brand-700'
              : 'text-slate-400 hover:text-slate-600 dark:text-slate-500'
          }`}
        >
          <LayoutGrid size={14} aria-hidden />
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === 'list'}
          aria-label={viewLabels.list}
          title={viewLabels.list}
          onClick={() => onChange('list')}
          className={`rounded-full p-1.5 transition-colors ${uiSurfaces.focusRing} ${
            value === 'list'
              ? 'bg-white text-brand-600 shadow-sm dark:bg-slate-100 dark:text-brand-700'
              : 'text-slate-400 hover:text-slate-600 dark:text-slate-500'
          }`}
        >
          <List size={14} aria-hidden />
        </button>
    </div>
  );
}
