import type { SupportTab } from '@/components/support/types';
import { uiSurfaces } from '@/lib/ui-surfaces';

type SupportTabsProps = {
  activeTab: SupportTab;
  onTabChange: (tab: SupportTab) => void;
};

export default function SupportTabs({
  activeTab,
  onTabChange,
}: SupportTabsProps) {
  const tabClass = (tab: SupportTab) =>
    `min-w-[120px] flex-1 rounded-brand px-4 py-3 text-sm font-semibold transition-all ${uiSurfaces.focusRing} ${
      activeTab === tab
        ? 'bg-brand-600 text-[var(--brand-color-text-on-primary)] shadow-md shadow-brand-600/20'
        : `${uiSurfaces.panel} ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} hover:bg-[var(--surface-hover)]`
    }`;

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <button
        onClick={() => onTabChange('protocols')}
        className={tabClass('protocols')}
      >
        实验方案
      </button>
      <button
        onClick={() => onTabChange('buffers')}
        className={tabClass('buffers')}
      >
        缓冲液配制
      </button>
      <button
        onClick={() => onTabChange('faqs')}
        className={tabClass('faqs')}
      >
        常见问题
      </button>
      <button
        onClick={() => onTabChange('calculators')}
        className={tabClass('calculators')}
      >
        计算工具
      </button>
      <button
        onClick={() => onTabChange('spectra')}
        className={tabClass('spectra')}
      >
        荧光光谱
      </button>
      <button
        onClick={() => onTabChange('cd-markers')}
        className={tabClass('cd-markers')}
      >
        CD 分子
      </button>
    </div>
  );
}
