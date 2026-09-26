import type { ElementType } from 'react';
import type { SupportTab } from '@/components/support/types';
import { uiSurfaces } from '@/lib/ui-surfaces';

type CategoryPill = {
  name: string;
  icon: ElementType;
  count: number;
};

type SupportCategoryPillsProps = {
  activeTab: SupportTab;
  categories: CategoryPill[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
};

export default function SupportCategoryPills({
  categories,
  selectedCategory,
  onSelectCategory,
}: SupportCategoryPillsProps) {
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {categories.map((cat) => {
        const Icon = cat.icon;
        return (
          <button
            key={cat.name}
            onClick={() => onSelectCategory(cat.name)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-all ${uiSurfaces.focusRing} ${
              selectedCategory === cat.name
                ? 'bg-brand-600 text-[var(--brand-color-text-on-primary)] shadow-md shadow-brand-600/20'
                : `${uiSurfaces.panel} ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} hover:bg-[var(--surface-hover)]`
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{cat.name}</span>
          </button>
        );
      })}
    </div>
  );
}
