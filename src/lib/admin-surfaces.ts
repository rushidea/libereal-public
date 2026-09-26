import { uiSurfaces } from '@/lib/ui-surfaces';

/** Shared semantic surfaces for admin and points workspaces. */
export const adminSurfaceClasses = {
  panel: `${uiSurfaces.panel} rounded-brand border-[var(--surface-border)]`,
  panelStrong: `${uiSurfaces.panelStrong} rounded-brand border-[var(--surface-border)]`,
  input: `${uiSurfaces.input} rounded-brand ${uiSurfaces.focusRing}`,
  button: `${uiSurfaces.buttonSecondary} rounded-brand ${uiSurfaces.focusRing}`,
  primaryButton: `${uiSurfaces.primaryButton} rounded-brand ${uiSurfaces.focusRing}`,
  modal: `${uiSurfaces.modal} rounded-brand shadow-[var(--shadow-panel-strong)]`,
  text: uiSurfaces.text,
  title: uiSurfaces.titleText,
  muted: uiSurfaces.mutedText,
  border: uiSurfaces.border,
  error: uiSurfaces.statusError,
  warning: uiSurfaces.statusWarning,
  success: uiSurfaces.statusSuccess,
} as const;
