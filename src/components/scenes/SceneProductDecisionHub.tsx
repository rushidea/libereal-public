'use client';

import Link from 'next/link';
import { ExternalLink, ShoppingBag, Target } from 'lucide-react';
import type { SceneDecisionPoint } from '@/data/scenes';
import SceneHashLink from '@/components/scenes/SceneHashLink';
import { sceneSurfaceClasses, type SceneTheme } from '@/lib/scene-theme';
import type { SceneUiCopy } from '@/lib/scene-ui-copy';

type SceneProductDecisionHubProps = {
  decisionPoints: SceneDecisionPoint[];
  fallbackProductLinks: { label: string; href: string }[];
  theme: SceneTheme;
  ui: NonNullable<SceneUiCopy['decisions']>;
};

export default function SceneProductDecisionHub({
  decisionPoints,
  fallbackProductLinks,
  theme,
  ui,
}: SceneProductDecisionHubProps) {
  const t = theme;

  return (
    <section className={`mb-8 p-4 sm:p-5 ${sceneSurfaceClasses.section}`}>
      <div className="mb-5">
        <div className={`mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${t.stepBadge}`}>
          <Target className="h-4 w-4" />
          {ui.sectionBadge}
        </div>
        <h2 className={`text-xl font-bold ${sceneSurfaceClasses.text}`}>{ui.title}</h2>
        <p className={`mt-1 text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>{ui.subtitle}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {decisionPoints.map((point, index) => {
          const links = point.productLinks?.length ? point.productLinks : fallbackProductLinks;
          return (
            <div
              key={point.title}
              className={`flex flex-col rounded-brand border p-4 ${sceneSurfaceClasses.subPanel} ${t.cardHoverBorder} transition`}
            >
              <div className="mb-2 flex items-start gap-2">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${t.softBg} ${t.softText}`}
                >
                  {index + 1}
                </span>
                <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>{point.title}</p>
              </div>
              <p className={`mb-3 flex-1 text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>{point.description}</p>
              <div className="flex flex-wrap gap-2">
                {links.map((link) => (
                  <SceneHashLink
                    key={link.href}
                    href={link.href}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${t.linkChip} ${t.linkChipHover} ${sceneSurfaceClasses.card} ${sceneSurfaceClasses.focusRing}`}
                  >
                    {link.label}
                    <ExternalLink className="h-3 w-3" />
                  </SceneHashLink>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className={`mt-4 flex flex-wrap items-center gap-3 rounded-brand border border-dashed px-4 py-3 ${sceneSurfaceClasses.card}`}>
        <p className={`text-sm ${sceneSurfaceClasses.mutedText}`}>已明确需求？</p>
        <Link
          href={ui.browseProductsHref}
          className={`inline-flex items-center gap-1.5 rounded-brand px-3 py-1.5 text-sm font-medium ${t.linkChip} ${t.linkChipHover} ${sceneSurfaceClasses.subPanel} ${sceneSurfaceClasses.focusRing}`}
        >
          {ui.browseProducts}
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        <SceneHashLink
          href="#bundle-selector"
          className={`inline-flex items-center gap-1.5 rounded-brand px-3 py-1.5 text-sm font-medium text-white ${t.primaryBtn} ${t.primaryBtnHover} ${sceneSurfaceClasses.focusRing}`}
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          {ui.viewBundles}
        </SceneHashLink>
      </div>
    </section>
  );
}
