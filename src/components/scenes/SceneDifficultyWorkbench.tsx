'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ClipboardCheck, ExternalLink, Lightbulb, Wrench } from 'lucide-react';
import type { SceneDifficulty } from '@/data/scenes';
import { sceneSurfaceClasses, type SceneTheme } from '@/lib/scene-theme';
import type { SceneUiCopy } from '@/lib/scene-ui-copy';

type SceneDifficultyWorkbenchProps = {
  difficulties: SceneDifficulty[];
  theme: SceneTheme;
  ui: SceneUiCopy['difficulty'];
};

export default function SceneDifficultyWorkbench({ difficulties, theme, ui }: SceneDifficultyWorkbenchProps) {
  const t = theme;
  const [activeId, setActiveId] = useState(difficulties[0]?.id ?? '');
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const activeDifficulty = useMemo(
    () => difficulties.find((difficulty) => difficulty.id === activeId) ?? difficulties[0],
    [activeId, difficulties],
  );

  if (!activeDifficulty) return null;

  const checkedCount = activeDifficulty.checks.filter((check) => checkedItems[`${activeDifficulty.id}:${check}`]).length;

  return (
    <section className={`mb-8 p-4 sm:p-5 ${sceneSurfaceClasses.section}`}>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">
            <Wrench className="h-4 w-4" />
            {ui.sectionBadge}
          </div>
          <h2 className={`text-xl font-bold ${sceneSurfaceClasses.text}`}>{ui.title}</h2>
          <p className={`mt-1 text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>{ui.subtitle}</p>
        </div>
        <div className={`rounded-brand px-3 py-2 text-sm ${sceneSurfaceClasses.card} ${sceneSurfaceClasses.mutedText}`}>
          {ui.progressPrefix} <span className={`font-semibold ${t.softText}`}>{checkedCount}</span> / {activeDifficulty.checks.length}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.78fr_1.22fr]">
        <div className="space-y-2">
          {difficulties.map((difficulty) => {
            const isActive = difficulty.id === activeDifficulty.id;
            return (
              <button
                key={difficulty.id}
                type="button"
                onClick={() => setActiveId(difficulty.id)}
                className={`w-full rounded-brand border p-4 text-left transition ${sceneSurfaceClasses.focusRing} ${
                  isActive
                    ? `${t.activeBorder} ${t.activeBg} ${t.strongText} shadow-sm`
                    : `${sceneSurfaceClasses.card} ${sceneSurfaceClasses.text} ${t.hoverBorder} ${t.hoverBg}`
                }`}
              >
                <span className="block text-sm font-semibold">{difficulty.label}</span>
                <span className={`mt-1 block text-sm leading-relaxed ${isActive ? t.softText : sceneSurfaceClasses.mutedText}`}>
                  {difficulty.symptom}
                </span>
              </button>
            );
          })}
        </div>

        <div className={`p-4 ${sceneSurfaceClasses.card}`}>
          <div className="mb-4">
            <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>{activeDifficulty.label}</p>
            <p className={`mt-1 text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>{activeDifficulty.symptom}</p>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className={`rounded-brand p-4 ${sceneSurfaceClasses.subPanel}`}>
              <p className={`mb-3 text-sm font-semibold ${sceneSurfaceClasses.text}`}>{ui.causesTitle}</p>
              <ul className={`space-y-2 text-sm ${sceneSurfaceClasses.mutedText}`}>
                {activeDifficulty.causes.map((cause) => (
                  <li key={cause} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                    {cause}
                  </li>
                ))}
              </ul>
            </div>

            <div className={`rounded-brand p-4 ${sceneSurfaceClasses.subPanel}`}>
              <p className={`mb-3 text-sm font-semibold ${sceneSurfaceClasses.text}`}>{ui.checksTitle}</p>
              <div className="space-y-2">
                {activeDifficulty.checks.map((check) => {
                  const key = `${activeDifficulty.id}:${check}`;
                  const checked = Boolean(checkedItems[key]);
                  return (
                    <label key={check} className={`flex cursor-pointer gap-2 rounded-brand p-2 text-sm ${sceneSurfaceClasses.card} ${sceneSurfaceClasses.mutedText}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setCheckedItems((current) => ({ ...current, [key]: !checked }))}
                        className={`mt-0.5 h-4 w-4 rounded border-[var(--surface-border)] ${sceneSurfaceClasses.focusRing} ${t.checkbox}`}
                      />
                      <span className={checked ? `line-through text-[var(--brand-color-text-quaternary)]` : ''}>{check}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_0.92fr]">
            <div className={`rounded-brand p-4 ${sceneSurfaceClasses.card}`}>
              <div className="mb-3 flex items-center gap-2">
                <ClipboardCheck className={`h-4 w-4 ${t.sectionIcon}`} />
                <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>{ui.fixesTitle}</p>
              </div>
              <ul className={`space-y-2 text-sm ${sceneSurfaceClasses.mutedText}`}>
                {activeDifficulty.fixes.map((fix) => (
                  <li key={fix} className="flex gap-2">
                    <CheckCircle2 className={`mt-0.5 h-4 w-4 flex-shrink-0 ${t.sectionIcon}`} />
                    {fix}
                  </li>
                ))}
              </ul>
            </div>

            <div className={`rounded-xl border p-4 ${t.hintPanel}`}>
              <div className="mb-3 flex items-center gap-2">
                <Lightbulb className={`h-4 w-4 ${t.hintIcon}`} />
                <p className={`text-sm font-semibold ${sceneSurfaceClasses.text}`}>{ui.adviceTitle}</p>
              </div>
              <p className={`mb-3 text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>{ui.adviceLead}</p>
              <p className={`mb-3 text-sm leading-relaxed ${sceneSurfaceClasses.mutedText}`}>{activeDifficulty.bundleHint}</p>
              <p className={`mb-2 text-xs font-semibold ${sceneSurfaceClasses.mutedText}`}>{ui.resourcesTitle}</p>
              <div className="mb-4 flex flex-wrap gap-2">
                {activeDifficulty.productLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium ${t.linkChip} ${t.linkChipHover} ${sceneSurfaceClasses.card} ${sceneSurfaceClasses.focusRing}`}
                  >
                    {link.label}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
