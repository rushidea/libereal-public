import { Search, X } from 'lucide-react';
import type { SupportTab } from '@/components/support/types';
import { uiSurfaces } from '@/lib/ui-surfaces';

function getSearchPlaceholder(activeTab: SupportTab) {
  switch (activeTab) {
    case 'protocols':
      return '搜索实验方案...';
    case 'buffers':
      return '搜索缓冲液配方...';
    case 'faqs':
      return '搜索常见问题...';
    case 'cd-markers':
      return '搜索 CD 分子编号或别名...';
    default:
      return '搜索...';
  }
}

type SupportSearchBarProps = {
  activeTab: SupportTab;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
};

export default function SupportSearchBar({
  activeTab,
  searchQuery,
  onSearchQueryChange,
}: SupportSearchBarProps) {
  return (
    <div className={`mb-4 rounded-2xl p-4 ${uiSurfaces.panel}`}>
      <div className="relative">
        <Search size={18} className={`absolute left-4 top-1/2 -translate-y-1/2 ${uiSurfaces.textInteractive}`} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder={getSearchPlaceholder(activeTab)}
          className={`w-full py-2.5 pl-10 pr-10 ${uiSurfaces.input} ${uiSurfaces.focusRing}`}
        />
        {searchQuery ? (
          <button
            onClick={() => onSearchQueryChange('')}
            className={`absolute right-3 top-1/2 -translate-y-1/2 ${uiSurfaces.textSecondary} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`}
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
