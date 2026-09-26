'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import BottomPopup from './BottomPopup';
import {
  mobileSiteNavigation,
  type SiteNavigationId,
  type SiteNavigationLink,
} from '@/data/site-navigation';
import { uiSurfaces } from '@/lib/ui-surfaces';

type MobileSiteMenuProps = {
  isOpen: boolean;
  onClose: () => void;
  onQuickOrder: () => void;
};

type MobileNavigationLinkProps = {
  link: SiteNavigationLink;
  depth?: number;
  expandedLinkIds: Set<string>;
  onToggle: (id: string) => void;
  onClose: () => void;
  onQuickOrder: () => void;
};

function MobileNavigationLink({
  link,
  depth = 0,
  expandedLinkIds,
  onToggle,
  onClose,
  onQuickOrder,
}: MobileNavigationLinkProps) {
  const hasChildren = Boolean(link.children?.length);
  const expanded = expandedLinkIds.has(link.id);
  const linkTextClassName = `min-w-0 flex-1 py-2.5 text-left text-sm ${depth > 0 ? uiSurfaces.textSecondary : 'text-[var(--brand-color-header-nav)]'} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`;
  const toggleLabel = `${expanded ? '收起' : '展开'}${link.label}`;

  return (
    <li>
      <div className="flex min-h-11 items-center border-b border-[var(--brand-color-border-secondary)]">
        {link.action === 'quick-order' ? (
          <button
            type="button"
            onClick={() => { onQuickOrder(); onClose(); }}
            className={`min-w-0 flex-1 py-2.5 text-left text-sm ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`}
          >
            {link.label}
          </button>
        ) : hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(link.id)}
            aria-expanded={expanded}
            aria-controls={`mobile-submenu-${link.id}`}
            className={linkTextClassName}
          >
            {link.label}
          </button>
        ) : link.href ? (
          <Link
            href={link.href}
            onClick={onClose}
            className={linkTextClassName}
          >
            {link.label}
          </Link>
        ) : (
          <span className={`min-w-0 flex-1 py-2.5 text-left text-sm ${uiSurfaces.textSecondary}`}>{link.label}</span>
        )}
        {hasChildren && (
          link.href ? (
            <Link
              href={link.href}
              onClick={onClose}
              aria-label={`前往${link.label}`}
              className={`flex h-10 w-10 shrink-0 items-center justify-center ${uiSurfaces.textQuaternary} ${uiSurfaces.focusRing}`}
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => onToggle(link.id)}
              aria-expanded={expanded}
              aria-label={toggleLabel}
              className={`flex h-10 w-10 shrink-0 items-center justify-center ${uiSurfaces.textQuaternary} ${uiSurfaces.focusRing}`}
            >
              <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
          )
        )}
      </div>
      {expanded && hasChildren && (
        <ul id={`mobile-submenu-${link.id}`} className="ml-3 border-l border-[var(--brand-color-border)] pl-3">
          {link.children?.map((child) => (
            <MobileNavigationLink
              key={child.id}
              link={child}
              depth={depth + 1}
              expandedLinkIds={expandedLinkIds}
              onToggle={onToggle}
              onClose={onClose}
              onQuickOrder={onQuickOrder}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function MobileSiteMenu({ isOpen, onClose, onQuickOrder }: MobileSiteMenuProps) {
  const [activeNavId, setActiveNavId] = useState<SiteNavigationId | null>(null);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [expandedLinkIds, setExpandedLinkIds] = useState<Set<string>>(new Set());
  const activeNavigation = mobileSiteNavigation.find((item) => item.id === activeNavId) ?? null;
  const activeGroup = activeNavigation?.groups.find((group) => group.id === activeGroupId) ?? activeNavigation?.groups[0];

  const closeMenu = () => {
    setActiveNavId(null);
    setActiveGroupId(null);
    setExpandedLinkIds(new Set());
    onClose();
  };

  const selectNavigation = (id: SiteNavigationId) => {
    const navigation = mobileSiteNavigation.find((item) => item.id === id);
    setActiveNavId(id);
    setActiveGroupId(navigation?.groups[0]?.id ?? null);
    setExpandedLinkIds(new Set());
  };

  const toggleLink = (id: string) => {
    setExpandedLinkIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <BottomPopup isOpen={isOpen} onClose={closeMenu} placement="top-left">
      <div id="mobile-site-menu" role="dialog" aria-modal="true" aria-label="站点导航">
        <div className={`flex items-center gap-2 border-b px-4 py-3 ${uiSurfaces.border}`}>
          {activeNavigation ? (
            <button
              type="button"
              onClick={() => { setActiveNavId(null); setActiveGroupId(null); setExpandedLinkIds(new Set()); }}
              className={`flex h-9 w-9 shrink-0 items-center justify-center ${uiSurfaces.textInteractive} ${uiSurfaces.focusRing}`}
              aria-label="返回一级栏目"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : (
            <Menu className={`h-5 w-5 ${uiSurfaces.textInteractive}`} />
          )}
          <div className="min-w-0 flex-1">
            {activeNavigation ? (
              <Link href={activeNavigation.href} onClick={closeMenu} className={`text-sm font-semibold ${uiSurfaces.titleText}`}>
                {activeNavigation.label}
              </Link>
            ) : (
              <p className={`text-sm font-semibold ${uiSurfaces.titleText}`}>站点导航</p>
            )}
          </div>
        </div>

        {!activeNavigation ? (
          <nav className="max-h-[70vh] overflow-y-auto px-4 py-2" aria-label="移动端站点导航">
            {mobileSiteNavigation.map((item) => (
              <div key={item.id} className="flex min-h-12 items-center border-b border-[var(--brand-color-border-secondary)]">
                <button
                  type="button"
                  onClick={() => selectNavigation(item.id)}
                  className={`min-w-0 flex-1 py-2 text-left text-base font-medium text-[var(--brand-color-header-nav)] ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`}
                >
                  {item.label}
                </button>
                <Link
                  href={item.href}
                  onClick={closeMenu}
                  aria-label={`前往${item.label}`}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center ${uiSurfaces.textQuaternary} ${uiSurfaces.focusRing}`}
                >
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>
            ))}
          </nav>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
            {activeNavigation.groups.length > 1 && (
              <div className="mb-3 flex gap-2 overflow-x-auto pb-1" aria-label={`${activeNavigation.label}分组`}>
                {activeNavigation.groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => { setActiveGroupId(group.id); setExpandedLinkIds(new Set()); }}
                    className={`shrink-0 border-b-2 px-1 py-2 text-sm ${activeGroup?.id === group.id ? 'border-[var(--brand-color-primary)] font-semibold text-[var(--brand-color-primary)]' : `border-transparent ${uiSurfaces.textSecondary}`} ${uiSurfaces.focusRing}`}
                  >
                    {group.label}
                  </button>
                ))}
              </div>
            )}
            {activeGroup && (
              <section aria-labelledby={`mobile-${activeGroup.id}`}>
                <h3 id={`mobile-${activeGroup.id}`} className={`mb-1 text-xs font-semibold ${uiSurfaces.textQuaternary}`}>
                  {activeGroup.label}
                </h3>
                <ul>
                  {activeGroup.links.map((link) => (
                    <MobileNavigationLink
                      key={link.id}
                      link={link}
                      expandedLinkIds={expandedLinkIds}
                      onToggle={toggleLink}
                      onClose={closeMenu}
                      onQuickOrder={onQuickOrder}
                    />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </BottomPopup>
  );
}
