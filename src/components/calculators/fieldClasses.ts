import { uiSurfaces } from '@/lib/ui-surfaces';

export const calculatorPanelClass = `${uiSurfaces.panel} rounded-brand`;
export const calculatorSubPanelClass = `${uiSurfaces.panelStrong} rounded-brand`;
export const calculatorResultClass = `${uiSurfaces.panel} rounded-brand`;
export const calculatorMutedTextClass = uiSurfaces.mutedText;

export const calculatorInputClass =
  `${uiSurfaces.input} w-full rounded-brand border-2 border-brand-500/50 px-3 py-2 text-sm text-[var(--brand-color-text)] ${uiSurfaces.focusRing} focus:border-brand-500`;

export const calculatorSelectClass = calculatorInputClass;

export const calculatorSaveInputClass =
  `${uiSurfaces.input} mb-2 w-full rounded-brand border border-emerald-300 px-3 py-2 text-sm text-[var(--brand-color-text)] ${uiSurfaces.focusRing} focus:border-emerald-400`;

export const calculatorCompactInputClass =
  `${uiSurfaces.inputCompact} w-full rounded-brand px-2 py-1 text-sm text-[var(--brand-color-text)] ${uiSurfaces.focusRing} focus:border-brand-400`;

export const calculatorTableInputClass =
  `${uiSurfaces.inputCompact} w-full rounded-brand px-2 py-1.5 text-sm text-[var(--brand-color-text)] ${uiSurfaces.focusRing} focus:border-brand-400`;

export const calculatorTextareaClass =
  `${uiSurfaces.input} w-full resize-none rounded-brand px-3 py-2 font-mono text-sm leading-relaxed text-[var(--brand-color-text)] ${uiSurfaces.focusRing} focus:border-brand-400`;
