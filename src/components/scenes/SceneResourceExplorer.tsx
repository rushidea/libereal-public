'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, BookOpen, Building2, ExternalLink, LifeBuoy } from 'lucide-react';
import type { SceneResource } from '@/data/scenes';
import { sceneSurfaceClasses, type SceneTheme } from '@/lib/scene-theme';
import type { SceneUiCopy } from '@/lib/scene-ui-copy';
import { getToolFaviconSrc } from '@/lib/tool-favicon';

type SceneLink = {
  label: string;
  href: string;
  description?: string;
  category?: string;
  iconUrl?: string;
};

type ResourceTab = 'protocols' | 'software' | 'support' | 'brands';

type SceneResourceExplorerProps = {
  protocols: SceneResource[];
  analysisSoftware?: SceneResource[];
  supportLinks: SceneResource[];
  brands: string[];
  theme: SceneTheme;
  ui: SceneUiCopy['resources'];
};

const tabs: Array<{
  id: ResourceTab;
  labelKey: 'tabProtocols' | 'tabSoftware' | 'tabSupport' | 'tabBrands';
  fallback: string;
  icon: typeof BookOpen;
}> = [
  { id: 'protocols', labelKey: 'tabProtocols', fallback: '方案', icon: BookOpen },
  { id: 'software', labelKey: 'tabSoftware', fallback: '分析软件', icon: BarChart3 },
  { id: 'support', labelKey: 'tabSupport', fallback: '支持', icon: LifeBuoy },
  { id: 'brands', labelKey: 'tabBrands', fallback: '品牌', icon: Building2 },
];

export default function SceneResourceExplorer({ protocols, analysisSoftware = [], supportLinks, brands, theme, ui }: SceneResourceExplorerProps) {
  const t = theme;
  const toolsFirst = Boolean(ui.tabSoftware?.includes('工具')) && analysisSoftware.length > 0;
  const [activeTab, setActiveTab] = useState<ResourceTab>(() => (toolsFirst ? 'software' : 'protocols'));
  const brandDescription = ui.brandLinkDescription ?? '查看该品牌相关产品。';
  const visibleTabs = useMemo(() => {
    const availableTabs = tabs.filter((tab) => tab.id !== 'software' || analysisSoftware.length > 0);
    if (!toolsFirst) return availableTabs;
    return [...availableTabs].sort((a, b) => {
      if (a.id === 'software') return -1;
      if (b.id === 'software') return 1;
      return 0;
    });
  }, [analysisSoftware.length, toolsFirst]);
  const items = useMemo<SceneLink[]>(() => {
    if (activeTab === 'protocols') return protocols;
    if (activeTab === 'software') return analysisSoftware;
    if (activeTab === 'support') return supportLinks;
    return brands.map((brand) => ({
      label: brand,
      href: `/products?brand=${encodeURIComponent(brand)}`,
      description: brandDescription.replace('{brand}', brand),
    }));
  }, [activeTab, analysisSoftware, brandDescription, brands, protocols, supportLinks]);
  const groupedItems = useMemo(() => {
    const groups: Array<{ category: string; items: SceneLink[] }> = [];
    for (const item of items) {
      const category = item.category ?? '';
      let group = groups.find((existing) => existing.category === category);
      if (!group) {
        group = { category, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  }, [items]);
  const hasCategorizedItems = groupedItems.some((group) => group.category.length > 0);

  function renderLinkCard(item: SceneLink) {
    const faviconUrl = getToolFaviconSrc(item.href, item.iconUrl);

    return (
      <Link key={`${activeTab}:${item.label}`} href={item.href} className={`p-4 ${sceneSurfaceClasses.card} ${t.cardHoverBorder} ${sceneSurfaceClasses.focusRing}`}>
        <span className="flex items-start justify-between gap-3">
          <span>
            <span className={`flex items-center gap-2 font-medium ${sceneSurfaceClasses.text}`}>
              {faviconUrl ? (
                <img
                  src={faviconUrl}
                  alt=""
                  aria-hidden="true"
                  className="h-4 w-4 flex-shrink-0 rounded-sm"
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              ) : null}
              <span>{item.label}</span>
            </span>
            {item.description ? <span className={`mt-1 block text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>{item.description}</span> : null}
          </span>
          <ExternalLink className={`mt-0.5 h-4 w-4 flex-shrink-0 ${sceneSurfaceClasses.mutedText}`} />
        </span>
      </Link>
    );
  }

  return (
    <section className={`mb-8 p-4 sm:p-5 ${sceneSurfaceClasses.section}`}>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className={`mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${t.stepBadge}`}>
            {ui.sectionBadge}
          </div>
          <h2 className={`text-xl font-bold ${sceneSurfaceClasses.text}`}>{ui.title}</h2>
          <p className={`mt-1 text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>{ui.subtitle}</p>
        </div>
        <div className={`grid gap-1 rounded-brand p-1 ${sceneSurfaceClasses.subPanel}`} style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` }}>
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex min-h-9 items-center justify-center gap-1 rounded-brand px-2 text-sm font-medium transition ${sceneSurfaceClasses.focusRing} ${
                  isActive ? `${sceneSurfaceClasses.card} ${t.tabActiveText} shadow-sm` : `${sceneSurfaceClasses.mutedText} hover:text-[var(--brand-color-text)]`
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{ui[tab.labelKey] ?? tab.fallback}</span>
              </button>
            );
          })}
        </div>
      </div>

      {hasCategorizedItems ? (
        <div className="space-y-5">
          {groupedItems.map((group) => (
            <div key={group.category || 'uncategorized'}>
              {group.category ? (
                <h3 className={`mb-2 text-sm font-semibold ${t.strongText}`}>{group.category}</h3>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map(renderLinkCard)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(renderLinkCard)}
        </div>
      )}
    </section>
  );
}
