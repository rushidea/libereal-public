'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Atom,
  Archive,
  BookOpen,
  Boxes,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Code2,
  Crop,
  Database,
  Dna,
  Eye,
  FlaskConical,
  GitBranch,
  Grid2X2,
  Image,
  Library,
  Microscope,
  Network,
  Quote,
  ScanLine,
  ScanSearch,
  ScatterChart,
  Scissors,
  ShieldCheck,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import {
  siteNavigation,
  siteNavigationById,
  type SiteNavigationId,
  type SiteNavigationIcon,
  type SiteNavigationLink,
} from '@/data/site-navigation';
import { getToolFaviconSrc } from '@/lib/tool-favicon';
import { uiSurfaces } from '@/lib/ui-surfaces';

type DesktopSiteNavigationProps = {
  activeNavId: SiteNavigationId | null;
  onActiveNavChange: (id: SiteNavigationId | null) => void;
  onQuickOrder: () => void;
};

const headerMutedText = 'text-[var(--brand-color-text-secondary)] dark:text-[var(--brand-color-header-nav)]';
const headerPrimaryText = 'text-[var(--brand-color-text)] dark:text-[var(--brand-color-header-nav)]';
const headerInteractiveText = 'text-[var(--brand-color-header-nav)]';
const headerInteractiveHover = 'hover:text-[var(--brand-color-header-nav-hover)]';
const headerInteractiveActive = 'text-[var(--brand-color-header-nav-hover)]';
const popupSurface = 'libereal-header-popup rounded-[var(--brand-border-radius)]';
const popupSection = 'border-[var(--brand-color-border-secondary)]';
const popupItem = `${uiSurfaces.focusRing} ${headerPrimaryText} hover:bg-[var(--brand-color-bg-hover)] ${headerInteractiveHover}`;

const navigationIcons: Record<SiteNavigationIcon, LucideIcon> = {
  atom: Atom,
  archive: Archive,
  'book-open': BookOpen,
  boxes: Boxes,
  chart: ChartNoAxesCombined,
  'circle-dot': CircleDot,
  code: Code2,
  crop: Crop,
  database: Database,
  dna: Dna,
  eye: Eye,
  flask: FlaskConical,
  'git-branch': GitBranch,
  grid: Grid2X2,
  image: Image,
  library: Library,
  microscope: Microscope,
  network: Network,
  quote: Quote,
  'scan-line': ScanLine,
  'scan-search': ScanSearch,
  'scatter-chart': ScatterChart,
  scissors: Scissors,
  'shield-check': ShieldCheck,
  table: Table2,
};

function NavigationIcon({ icon, href }: { icon?: SiteNavigationIcon; href?: string }) {
  const faviconSrc = href ? getToolFaviconSrc(href) : null;
  const Icon = icon ? navigationIcons[icon] : null;
  if (faviconSrc) {
    return (
      <img
        src={faviconSrc}
        alt=""
        aria-hidden="true"
        className="h-4 w-4 shrink-0 rounded-sm object-contain"
        loading="lazy"
      />
    );
  }

  return Icon ? <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${headerMutedText}`} strokeWidth={1.7} /> : null;
}

function closeAfter(onActiveNavChange: (id: SiteNavigationId | null) => void) {
  return () => onActiveNavChange(null);
}

function MenuTrigger({
  link,
  hasChildren,
  onClose,
  onQuickOrder,
  className = '',
}: {
  link: SiteNavigationLink;
  hasChildren: boolean;
  onClose: () => void;
  onQuickOrder: () => void;
  className?: string;
}) {
  const content = (
    <>
      <NavigationIcon icon={link.icon} href={link.href} />
      <span className="min-w-0 flex-1 truncate">{link.label}</span>
      {hasChildren ? <ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${headerMutedText}`} /> : null}
    </>
  );

  if (link.action === 'quick-order') {
    return (
      <button
        type="button"
        onClick={() => { onQuickOrder(); onClose(); }}
        className={`text-left ${className}`}
      >
        {content}
      </button>
    );
  }

  if (link.href) {
    return (
      <Link href={link.href} onClick={onClose} className={className}>
        {content}
      </Link>
    );
  }

  if (hasChildren) {
    return (
      <button type="button" className={className}>
        {content}
      </button>
    );
  }

  return <span className={className}>{link.label}</span>;
}

function LinkItem({
  link,
  onClose,
  onQuickOrder,
  className = '',
}: {
  link: SiteNavigationLink;
  onClose: () => void;
  onQuickOrder: () => void;
  className?: string;
}) {
  return <MenuTrigger link={link} hasChildren={false} onClose={onClose} onQuickOrder={onQuickOrder} className={className} />;
}

function CascadeMenuItem({
  link,
  onClose,
  onQuickOrder,
  depth = 0,
}: {
  link: SiteNavigationLink;
  onClose: () => void;
  onQuickOrder: () => void;
  depth?: number;
}) {
  const hasChildren = Boolean(link.children?.length);
  const className = depth === 0
    ? `flex items-start justify-between gap-2 rounded-[var(--brand-border-radius)] px-3 py-2 text-left text-sm font-medium leading-5 ${popupItem}`
    : `flex items-start justify-between gap-2 rounded-[var(--brand-border-radius)] px-3 py-2 text-left text-xs leading-5 ${popupItem}`;

  return (
    <div data-nav-item className="relative">
      <MenuTrigger link={link} hasChildren={hasChildren} onClose={onClose} onQuickOrder={onQuickOrder} className={className} />
      {hasChildren ? (
        <div data-nav-submenu className="left-full top-0 pl-2">
          <div data-header-popup className={`max-h-[calc(100vh-7rem)] ${depth === 0 ? 'w-[min(24rem,calc(100vw-3rem))]' : 'w-[min(20rem,calc(100vw-3rem))]'} overflow-y-auto p-2 ${popupSurface}`}>
            <div className="space-y-0.5">
              {link.children?.map((child) => (
                <CascadeMenuItem key={child.id} link={child} onClose={onClose} onQuickOrder={onQuickOrder} depth={depth + 1} />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CascadeDropdown({
  label,
  links,
  onClose,
  onQuickOrder,
}: {
  label: string;
  links: SiteNavigationLink[];
  onClose: () => void;
  onQuickOrder: () => void;
}) {
  const deepLink = links.find((link) => link.children?.some((child) => child.children?.length));

  if (deepLink) {
    return (
      <DeepCascadeDropdown
        links={links}
        deepLink={deepLink}
        onClose={onClose}
        onQuickOrder={onQuickOrder}
      />
    );
  }

  return (
    <div data-header-popup className={`w-[min(15rem,calc(100vw-2rem))] p-2 ${popupSurface}`}>
      <p className={`px-3 pb-2 text-[11px] font-semibold ${headerMutedText}`}>{label}</p>
      <div className="space-y-0.5">
        {links.map((link) => (
          <CascadeMenuItem key={link.id} link={link} onClose={onClose} onQuickOrder={onQuickOrder} />
        ))}
      </div>
    </div>
  );
}

function DeepCascadeDropdown({
  links,
  deepLink,
  onClose,
  onQuickOrder,
}: {
  links: SiteNavigationLink[];
  deepLink: SiteNavigationLink;
  onClose: () => void;
  onQuickOrder: () => void;
}) {
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const activeCategory = deepLink.children?.find((link) => link.id === activeCategoryId) ?? deepLink.children?.[0];

  return (
    <div data-header-popup className={`w-[min(62rem,calc(100vw-2rem))] overflow-hidden ${popupSurface}`}>
      <div className="grid max-h-[calc(100vh-8rem)] grid-cols-[12rem_18rem_minmax(0,1fr)] divide-x divide-[var(--brand-color-border-secondary)]">
        <div className="min-w-0 overflow-y-auto p-2">
          <p className={`px-2 pb-1 text-[11px] font-semibold ${headerMutedText}`}>研究工具</p>
          <div className="space-y-0.5">
            {links.map((link) => {
              const isDeepLink = link.id === deepLink.id;
              if (!isDeepLink) {
                return (
                  <LinkItem
                    key={link.id}
                    link={link}
                    onClose={onClose}
                    onQuickOrder={onQuickOrder}
                    className={`flex items-center rounded-[var(--brand-border-radius)] px-3 py-2 text-sm ${popupItem}`}
                  />
                );
              }

              return (
                <Link
                  key={link.id}
                  href={link.href ?? '#'}
                  onClick={onClose}
                  onMouseEnter={() => setActiveCategoryId(link.children?.[0]?.id ?? null)}
                  onFocus={() => setActiveCategoryId(link.children?.[0]?.id ?? null)}
                  className={`flex items-start justify-between gap-2 rounded-[var(--brand-border-radius)] px-3 py-2 text-left text-sm font-medium ${activeCategory ? `bg-[var(--brand-color-primary-bg)] ${headerInteractiveActive}` : popupItem}`}
                >
                  <span className="min-w-0">{link.label}</span>
                  <ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${headerMutedText}`} />
                </Link>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 overflow-y-auto p-2">
          <p className={`px-2 pb-1 text-[11px] font-semibold ${headerMutedText}`}>{deepLink.label}</p>
          <div className="space-y-0.5">
            {deepLink.children?.map((category) => (
              <button
                key={category.id}
                type="button"
                onMouseEnter={() => setActiveCategoryId(category.id)}
                onFocus={() => setActiveCategoryId(category.id)}
                className={`flex w-full items-start justify-between gap-2 rounded-[var(--brand-border-radius)] px-3 py-2 text-left text-xs leading-5 ${activeCategory?.id === category.id ? `bg-[var(--brand-color-primary-bg)] ${headerInteractiveActive}` : popupItem}`}
              >
                <span className="min-w-0">{category.label}</span>
                <ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${headerMutedText}`} />
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 overflow-y-auto p-2">
          <p className={`px-2 pb-1 text-[11px] font-semibold ${headerMutedText}`}>{activeCategory?.label ?? '选择工具分类'}</p>
          <div className="space-y-0.5">
            {activeCategory?.children?.map((tool) => (
              <LinkItem
                key={tool.id}
                link={tool}
                onClose={onClose}
                onQuickOrder={onQuickOrder}
                className={`flex items-center rounded-[var(--brand-border-radius)] px-3 py-2 text-sm ${popupItem}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductShortcutGrid({
  links,
  onClose,
  onQuickOrder,
}: {
  links: SiteNavigationLink[];
  onClose: () => void;
  onQuickOrder: () => void;
}) {
  return (
    <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-3">
      <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
        {links.map((link) => (
          <LinkItem
            key={link.id}
            link={link}
            onClose={onClose}
            onQuickOrder={onQuickOrder}
            className={`rounded-[var(--brand-border-radius)] px-3 py-2 text-sm ${popupItem}`}
          />
        ))}
      </div>
    </div>
  );
}

function ProductPromotionBrowser({
  brands,
  activeBrandId,
  onBrandChange,
  onClose,
  onQuickOrder,
}: {
  brands: SiteNavigationLink[];
  activeBrandId: string | null;
  onBrandChange: (id: string) => void;
  onClose: () => void;
  onQuickOrder: () => void;
}) {
  const activeBrand = brands.find((brand) => brand.id === activeBrandId) ?? brands[0];

  return (
    <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-3">
      <div className={`border-b pb-2 ${popupSection}`}>
        <p className={`px-2 pb-1 text-[11px] font-semibold ${headerMutedText}`}>促销品牌</p>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="促销品牌">
          {brands.map((brand) => (
            <button
              key={brand.id}
              type="button"
              role="tab"
              aria-selected={activeBrand?.id === brand.id}
              onClick={() => onBrandChange(brand.id)}
              onMouseEnter={() => onBrandChange(brand.id)}
              onFocus={() => onBrandChange(brand.id)}
              className={`rounded-[var(--brand-border-radius)] px-2.5 py-1.5 text-xs transition-colors ${activeBrand?.id === brand.id ? `bg-[var(--brand-color-primary-bg)] ${headerInteractiveActive}` : popupItem}`}
            >
              {brand.label}
            </button>
          ))}
        </div>
      </div>

      {activeBrand ? (
        <section className="pt-3">
          <Link
            href={activeBrand.href ?? '/promotions'}
            onClick={onClose}
            className={`mb-2 inline-flex rounded-[var(--brand-border-radius)] px-2 py-1 text-sm font-semibold ${headerInteractiveText} ${headerInteractiveHover} ${uiSurfaces.focusRing}`}
          >
            {activeBrand.label}
          </Link>
          <div className="grid gap-1 sm:grid-cols-2">
            {activeBrand.children?.map((activity) => (
              <LinkItem
                key={activity.id}
                link={activity}
                onClose={onClose}
                onQuickOrder={onQuickOrder}
                className={`rounded-[var(--brand-border-radius)] px-3 py-2 text-sm ${popupItem}`}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ProductDropdown({
  onClose,
  onQuickOrder,
  activeTabId,
  onTabChange,
  activeCategoryId,
  onCategoryChange,
  activeSubcategoryId,
  onSubcategoryChange,
  activePromotionBrandId,
  onPromotionBrandChange,
}: {
  onClose: () => void;
  onQuickOrder: () => void;
  activeTabId: string | null;
  onTabChange: (id: string) => void;
  activeCategoryId: string | null;
  onCategoryChange: (id: string) => void;
  activeSubcategoryId: string | null;
  onSubcategoryChange: (id: string) => void;
  activePromotionBrandId: string | null;
  onPromotionBrandChange: (id: string) => void;
}) {
  const tabs = siteNavigationById.products.groups;
  const catalogTab = tabs.find((group) => group.id === 'product-catalog') ?? tabs[0];
  const activeTab = tabs.find((group) => group.id === activeTabId) ?? tabs[0];
  const activeCategory = catalogTab?.links.find((link) => link.id === activeCategoryId) ?? catalogTab?.links[0];
  const activeSubcategory = activeCategory?.children?.find((link) => link.id === activeSubcategoryId) ?? activeCategory?.children?.[0];
  const productMenuFooterLinks = siteNavigationById.products.footerLinks.filter(
    (link) => !tabs.some((group) => group.id === link.id),
  );

  return (
    <div data-header-popup className={`w-[min(62rem,calc(100vw-2rem))] overflow-hidden ${popupSurface}`}>
      <div className={`border-b p-2 ${popupSection}`}>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="产品中心">
          {tabs.map((group) => (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={activeTab.id === group.id}
              onClick={() => onTabChange(group.id)}
              onMouseEnter={() => onTabChange(group.id)}
              onFocus={() => onTabChange(group.id)}
              className={`rounded-[var(--brand-border-radius)] px-3 py-1.5 text-sm transition-colors ${activeTab.id === group.id ? `bg-[var(--brand-color-primary-bg)] ${headerInteractiveActive}` : popupItem}`}
            >
              {group.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab.id === 'product-catalog' ? (
        <div className="grid min-h-72 grid-cols-[10rem_minmax(0,14rem)_minmax(0,1fr)] divide-x divide-[var(--brand-color-border-secondary)]">
          <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-2">
            <p className={`px-2 pb-1 text-[11px] font-semibold ${headerMutedText}`}>产品分类</p>
            {catalogTab?.links.map((link) => (
              <Link
                key={link.id}
                href={link.href ?? '/products'}
                onClick={onClose}
                onMouseEnter={() => {
                  onCategoryChange(link.id);
                  onSubcategoryChange(link.children?.[0]?.id ?? '');
                }}
                onFocus={() => {
                  onCategoryChange(link.id);
                  onSubcategoryChange(link.children?.[0]?.id ?? '');
                }}
                className={`flex items-center justify-between rounded-[var(--brand-border-radius)] px-2 py-2 text-xs transition-colors ${activeCategory?.id === link.id ? `bg-[var(--brand-color-primary-bg)] ${headerInteractiveActive}` : popupItem}`}
              >
                <span className="truncate">{link.label}</span>
                {link.children?.length ? <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${headerMutedText}`} /> : null}
              </Link>
            ))}
          </div>
          <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-2">
            <p className={`px-2 pb-1 text-[11px] font-semibold ${headerMutedText}`}>{activeCategory?.label ?? '产品分类'}</p>
            {activeCategory?.children?.map((link) => (
              <Link
                key={link.id}
                href={link.href ?? '/products'}
                onClick={onClose}
                onMouseEnter={() => onSubcategoryChange(link.id)}
                onFocus={() => onSubcategoryChange(link.id)}
                className={`flex items-center justify-between rounded-[var(--brand-border-radius)] px-2 py-2 text-xs ${activeSubcategory?.id === link.id ? `bg-[var(--brand-color-primary-bg)] ${headerInteractiveActive}` : popupItem}`}
              >
                <span className="truncate">{link.label}</span>
                {link.children?.length ? <ChevronRight className={`h-3.5 w-3.5 shrink-0 ${headerMutedText}`} /> : null}
              </Link>
            ))}
          </div>
          <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-2">
            <p className={`px-2 pb-1 text-[11px] font-semibold ${headerMutedText}`}>{activeSubcategory?.label ?? '选择子分类'}</p>
            {activeSubcategory?.children?.map((link) => (
              <LinkItem
                key={link.id}
                link={link}
                onClose={onClose}
                onQuickOrder={onQuickOrder}
                className={`block rounded-[var(--brand-border-radius)] px-2 py-2 text-xs ${popupItem}`}
              />
            ))}
          </div>
        </div>
      ) : activeTab.id === 'product-promotions' ? (
        <ProductPromotionBrowser
          brands={activeTab.links}
          activeBrandId={activePromotionBrandId}
          onBrandChange={onPromotionBrandChange}
          onClose={onClose}
          onQuickOrder={onQuickOrder}
        />
      ) : (
        <ProductShortcutGrid links={activeTab.links} onClose={onClose} onQuickOrder={onQuickOrder} />
      )}

      <div className={`flex flex-wrap gap-1 border-t p-2 ${popupSection}`}>
        {productMenuFooterLinks.map((link) => (
          <LinkItem
            key={link.id}
            link={link}
            onClose={onClose}
            onQuickOrder={onQuickOrder}
            className={`rounded-[var(--brand-border-radius)] px-3 py-2 text-sm ${popupItem}`}
          />
        ))}
      </div>
    </div>
  );
}

function AcademicDropdown({
  onClose,
  onQuickOrder,
  activeLinkId,
  onLinkChange,
  activeGroupId,
  onGroupChange,
  activeSectionId,
  onSectionChange,
}: {
  onClose: () => void;
  onQuickOrder: () => void;
  activeLinkId: string | null;
  onLinkChange: (id: string) => void;
  activeGroupId: string | null;
  onGroupChange: (id: string) => void;
  activeSectionId: string | null;
  onSectionChange: (id: string) => void;
}) {
  const links = siteNavigationById['academic-support'].groups[0]?.links ?? [];
  const activeLink = links.find((link) => link.id === activeLinkId) ?? links[0];
  const group = activeLink?.children?.find((link) => link.id === activeGroupId) ?? activeLink?.children?.[0];
  const section = group?.children?.find((link) => link.id === activeSectionId) ?? group?.children?.[0];
  const isResearchTrend = activeLink?.id === 'research-trends';

  return (
    <div data-header-popup className={`max-h-[calc(100vh-6rem)] w-[min(62rem,calc(100vw-2rem))] overflow-y-auto p-3 ${popupSurface}`}>
      <div className={`border-b pb-2 ${popupSection}`}>
        <p className={`px-2 pb-1 text-[11px] font-semibold ${headerMutedText}`}>学术支持</p>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="学术支持">
          {links.map((link) => (
            <button
              key={link.id}
              type="button"
              role="tab"
              aria-selected={activeLink?.id === link.id}
              onClick={() => onLinkChange(link.id)}
              onMouseEnter={() => onLinkChange(link.id)}
              onFocus={() => onLinkChange(link.id)}
              className={`rounded-[var(--brand-border-radius)] px-2.5 py-1.5 text-xs transition-colors ${activeLink?.id === link.id ? `bg-[var(--brand-color-primary-bg)] ${headerInteractiveActive}` : popupItem}`}
            >
              {link.label}
            </button>
          ))}
        </div>
      </div>
      {activeLink && isResearchTrend ? (
        <section className="pt-3">
          <Link href={activeLink.href ?? '/research/trends'} onClick={onClose} className={`mb-2 inline-flex rounded-[var(--brand-border-radius)] px-2 py-1 text-sm font-semibold ${headerInteractiveText} ${headerInteractiveHover} ${uiSurfaces.focusRing}`}>{activeLink.label}</Link>
          <div className="grid min-h-56 grid-cols-[12rem_14rem_minmax(0,1fr)] divide-x divide-[var(--brand-color-border-secondary)]">
            <div className="min-w-0 pr-3">
              {activeLink.children?.map((link) => (
                <button
                  key={link.id}
                  type="button"
                  onMouseEnter={() => { onGroupChange(link.id); onSectionChange(link.children?.[0]?.id ?? ''); }}
                  onFocus={() => { onGroupChange(link.id); onSectionChange(link.children?.[0]?.id ?? ''); }}
                  className={`flex w-full items-start justify-between gap-2 rounded-[var(--brand-border-radius)] px-2 py-2 text-left text-xs leading-5 ${group?.id === link.id ? `bg-[var(--brand-color-primary-bg)] ${headerInteractiveActive}` : popupItem}`}
                >
                  <span className="min-w-0">{link.label}</span>
                  <ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${headerMutedText}`} />
                </button>
              ))}
            </div>
            <div className="min-w-0 px-3">
              <p className={`px-2 pb-1 text-[11px] font-semibold ${headerMutedText}`}>{group?.label ?? '研究主题'}</p>
              {group?.children?.map((link) => (
                <button
                  key={link.id}
                  type="button"
                  onMouseEnter={() => onSectionChange(link.id)}
                  onFocus={() => onSectionChange(link.id)}
                  className={`flex w-full items-start justify-between gap-2 rounded-[var(--brand-border-radius)] px-2 py-2 text-left text-xs leading-5 ${section?.id === link.id ? `bg-[var(--brand-color-primary-bg)] ${headerInteractiveActive}` : popupItem}`}
                >
                  <span className="min-w-0">{link.label}</span>
                  <ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${headerMutedText}`} />
                </button>
              ))}
            </div>
            <div className="min-w-0 pl-3">
              <p className={`px-2 pb-1 text-[11px] font-semibold ${headerMutedText}`}>{section?.label ?? '研究专题'}</p>
              {section?.children?.map((link) => (
                <Link
                  key={link.id}
                  href={link.href ?? '/research/trends'}
                  onClick={onClose}
                  className={`flex items-start gap-2 rounded-[var(--brand-border-radius)] px-2 py-2 text-left text-xs leading-5 ${popupItem}`}
                >
                  <span className={`shrink-0 font-mono text-[10px] ${headerMutedText}`}>{link.id}</span>
                  <span className="min-w-0">{link.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : activeLink ? (
        <section className="pt-3">
          <Link href={activeLink.href ?? '/academic-support'} onClick={onClose} className={`mb-2 inline-flex rounded-[var(--brand-border-radius)] px-2 py-1 text-sm font-semibold ${headerInteractiveText} ${headerInteractiveHover} ${uiSurfaces.focusRing}`}>{activeLink.label}</Link>
          <div className="space-y-0.5">
            {activeLink.children?.map((link) => (
              <LinkItem key={link.id} link={link} onClose={onClose} onQuickOrder={onQuickOrder} className={`block rounded-[var(--brand-border-radius)] px-2 py-2 text-sm ${popupItem}`} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default function DesktopSiteNavigation({ activeNavId, onActiveNavChange, onQuickOrder }: DesktopSiteNavigationProps) {
  const close = closeAfter(onActiveNavChange);
  const [activeProductTabId, setActiveProductTabId] = useState<string | null>(null);
  const [activeProductCategoryId, setActiveProductCategoryId] = useState<string | null>(null);
  const [activeProductSubcategoryId, setActiveProductSubcategoryId] = useState<string | null>(null);
  const [activePromotionBrandId, setActivePromotionBrandId] = useState<string | null>(null);
  const [activeAcademicLinkId, setActiveAcademicLinkId] = useState<string | null>(null);
  const [activeResearchGroupId, setActiveResearchGroupId] = useState<string | null>(null);
  const [activeResearchSectionId, setActiveResearchSectionId] = useState<string | null>(null);

  return (
    <nav data-site-nav className="relative z-[60] hidden max-h-11 items-center justify-between overflow-visible border-t border-[var(--brand-color-primary-border)] px-4 py-2 lg:flex">
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 xl:gap-6">
        {siteNavigation.map((item) => {
          const open = activeNavId === item.id;
          const useViewportCenteredDropdown = item.id === 'products' || item.id === 'research-tools' || item.id === 'academic-support';
          return (
            <div
              key={item.id}
              className="relative flex h-9 items-center"
              onMouseEnter={() => onActiveNavChange(item.id)}
              onMouseLeave={() => onActiveNavChange(null)}
              onFocusCapture={() => onActiveNavChange(item.id)}
              onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) close(); }}
            >
              <Link
                href={item.href}
                onClick={close}
                aria-expanded={open}
                aria-haspopup="menu"
                className={`flex items-center gap-1 whitespace-nowrap px-2 text-sm font-medium transition-colors ${open ? headerInteractiveActive : headerInteractiveText} ${headerInteractiveHover} ${uiSurfaces.focusRing}`}
              >
                {item.label}
                <ChevronDown size={14} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
              </Link>
              <div
                data-nav-dropdown
                data-nav-open={open ? 'true' : 'false'}
                data-nav-viewport-dropdown={useViewportCenteredDropdown ? 'true' : undefined}
                style={useViewportCenteredDropdown ? { top: 'calc(var(--site-header-height) - 0.375rem)' } : undefined}
                className={`${useViewportCenteredDropdown ? 'fixed left-1/2' : 'absolute left-1/2 top-full -translate-x-1/2'} z-[70] pt-1 transition-all duration-200 ${open ? 'visible pointer-events-auto opacity-100' : 'invisible pointer-events-none opacity-0'}`}
              >
                {item.id === 'products' ? (
                  <ProductDropdown
                    onClose={close}
                    onQuickOrder={onQuickOrder}
                    activeTabId={activeProductTabId}
                    onTabChange={setActiveProductTabId}
                    activeCategoryId={activeProductCategoryId}
                    onCategoryChange={setActiveProductCategoryId}
                    activeSubcategoryId={activeProductSubcategoryId}
                    onSubcategoryChange={setActiveProductSubcategoryId}
                    activePromotionBrandId={activePromotionBrandId}
                    onPromotionBrandChange={setActivePromotionBrandId}
                  />
                ) : item.id === 'research-tools' ? (
                  <CascadeDropdown
                    label={item.groups[0]?.label ?? item.label}
                    links={item.groups[0]?.links ?? []}
                    onClose={close}
                    onQuickOrder={onQuickOrder}
                  />
                ) : item.id === 'resources' ? (
                  <CascadeDropdown
                    label={item.groups[0]?.label ?? item.label}
                    links={item.groups[0]?.links ?? []}
                    onClose={close}
                    onQuickOrder={onQuickOrder}
                  />
                ) : item.id === 'academic-support' ? (
                  <AcademicDropdown
                    onClose={close}
                    onQuickOrder={onQuickOrder}
                    activeLinkId={activeAcademicLinkId}
                    onLinkChange={setActiveAcademicLinkId}
                    activeGroupId={activeResearchGroupId}
                    onGroupChange={setActiveResearchGroupId}
                    activeSectionId={activeResearchSectionId}
                    onSectionChange={setActiveResearchSectionId}
                  />
                ) : (
                  <CascadeDropdown
                    label={item.groups[0]?.label ?? item.label}
                    links={item.groups[0]?.links ?? []}
                    onClose={close}
                    onQuickOrder={onQuickOrder}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
