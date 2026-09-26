import Link from 'next/link';
import { uiSurfaces } from '@/lib/ui-surfaces';

export type DiscoveriesTab = 'articles' | 'journals';

const TABS: { id: DiscoveriesTab | 'trends'; label: string; href: string }[] = [
  { id: 'articles', label: '服务号文章', href: '/discoveries' },
  { id: 'journals', label: '期刊论文', href: '/discoveries?tab=journals' },
  { id: 'trends', label: '研究热点', href: '/research/trends' },
];

export default function DiscoveriesTabs({ active }: { active: DiscoveriesTab }) {
  return (
    <div className="mb-6 flex gap-2" role="tablist" aria-label="发现内容分类">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            role="tab"
            aria-selected={isActive}
            className={`rounded-brand px-4 py-2 text-sm font-semibold transition ${uiSurfaces.focusRing} ${
              isActive
                ? 'bg-brand-700 text-[var(--brand-color-text-on-primary)] shadow-[0_10px_24px_color-mix(in_srgb,var(--brand-color-primary)_18%,transparent)]'
                : `${uiSurfaces.panel} ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} hover:bg-[var(--surface-hover)]`
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
