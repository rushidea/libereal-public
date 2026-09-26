'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ExternalLink, GitBranch, ListChecks } from 'lucide-react';
import type { SceneWorkflowStep } from '@/data/scenes';
import SceneHashLink from '@/components/scenes/SceneHashLink';
import { sceneSurfaceClasses, type SceneTheme } from '@/lib/scene-theme';
import type { SceneUiCopy } from '@/lib/scene-ui-copy';

type SceneWorkflowNavigatorProps = {
  workflow: SceneWorkflowStep[];
  theme: SceneTheme;
  ui: NonNullable<SceneUiCopy['workflow']>;
};

export default function SceneWorkflowNavigator({ workflow, theme, ui }: SceneWorkflowNavigatorProps) {
  const t = theme;
  const [activeIndex, setActiveIndex] = useState(0);
  const activeStep = useMemo(() => workflow[activeIndex] ?? workflow[0], [activeIndex, workflow]);

  if (!activeStep) return null;

  return (
    <section className={`mb-8 p-4 sm:p-5 ${sceneSurfaceClasses.section}`}>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className={`mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${t.stepBadge}`}>
            <GitBranch className="h-4 w-4" />
            {ui.sectionBadge}
          </div>
          <h2 className={`text-xl font-bold ${sceneSurfaceClasses.text}`}>{ui.title}</h2>
          <p className={`mt-1 text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>{ui.subtitle}</p>
        </div>
      </div>

      <div className="mb-4 hidden sm:flex sm:items-center sm:gap-1">
        {workflow.map((step, index) => {
          const isActive = index === activeIndex;
          const isLast = index === workflow.length - 1;
          return (
            <div key={step.title} className="flex min-w-0 flex-1 items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveIndex(index)}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-brand border px-3 py-2.5 text-left transition ${sceneSurfaceClasses.focusRing} ${
                  isActive
                    ? `${t.activeBorder} ${t.activeBg} ${t.strongText} shadow-sm`
                    : `${sceneSurfaceClasses.card} ${sceneSurfaceClasses.text} ${t.hoverBorder} ${t.hoverBg}`
                }`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    isActive ? `${t.primaryBtn} text-white` : 'bg-[var(--surface-muted)] text-[var(--brand-color-text-secondary)]'
                  }`}
                >
                  {index + 1}
                </span>
                <span className="truncate text-sm font-medium">{step.title}</span>
              </button>
              {!isLast ? <ArrowRight className="h-4 w-4 shrink-0 text-[var(--brand-color-text-quaternary)]" aria-hidden /> : null}
            </div>
          );
        })}
      </div>

      <div className="mb-4 space-y-2 sm:hidden">
        {workflow.map((step, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={step.title}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`flex w-full items-center gap-3 rounded-brand border p-3 text-left transition ${sceneSurfaceClasses.focusRing} ${
                isActive
                  ? `${t.activeBorder} ${t.activeBg} ${t.strongText} shadow-sm`
                  : `${sceneSurfaceClasses.card} ${sceneSurfaceClasses.text} ${t.hoverBorder} ${t.hoverBg}`
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isActive ? `${t.primaryBtn} text-white` : 'bg-[var(--surface-muted)] text-[var(--brand-color-text-secondary)]'
                }`}
              >
                {index + 1}
              </span>
              <span className="text-sm font-medium">{step.title}</span>
            </button>
          );
        })}
      </div>

      <div className={`p-4 ${sceneSurfaceClasses.subPanel}`}>
        <div className="mb-4">
          <p className={`text-base font-semibold ${sceneSurfaceClasses.text}`}>{activeStep.title}</p>
          <p className={`mt-1 text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>{activeStep.description}</p>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className={`p-3 ${sceneSurfaceClasses.card}`}>
            <div className="mb-2 flex items-center gap-2">
              <ListChecks className={`h-4 w-4 ${t.sectionIcon}`} />
              <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>{ui.checksTitle}</p>
            </div>
            <ul className="space-y-1.5">
              {activeStep.checks.map((check) => (
                <li key={check} className={`flex gap-2 text-sm ${sceneSurfaceClasses.mutedText}`}>
                  <CheckCircle2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${t.sectionIcon}`} />
                  {check}
                </li>
              ))}
            </ul>
          </div>

          <div className={`p-3 ${sceneSurfaceClasses.card}`}>
            <p className={`mb-2 text-sm font-semibold ${sceneSurfaceClasses.text}`}>{ui.outputsTitle}</p>
            <ul className="space-y-1.5">
              {activeStep.outputs.map((output) => (
                <li key={output} className={`flex gap-2 text-sm ${sceneSurfaceClasses.mutedText}`}>
                  <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${t.primaryBtn}`} />
                  {output}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {activeStep.productLinks.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className={`text-xs ${sceneSurfaceClasses.mutedText}`}>{ui.productsTitle}：</p>
            {activeStep.productLinks.map((link) => (
              <SceneHashLink
                key={link.href}
                href={link.href}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ${t.linkChip} ${t.linkChipHover} ${sceneSurfaceClasses.card} ${sceneSurfaceClasses.focusRing}`}
              >
                {link.label}
                <ExternalLink className="h-3 w-3" />
              </SceneHashLink>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
