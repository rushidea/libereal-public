/**
 * Homepage text contrast by surface.
 * Uses brand tokens so night medium-gray panels stay readable.
 */
export const homeText = {
  onLight: {
    title: 'text-gray-900 dark:text-[var(--brand-color-text)]',
    body: 'text-gray-600 dark:text-[var(--brand-color-text-secondary)]',
    muted: 'text-gray-500 dark:text-[var(--brand-color-text-secondary)]',
    label: 'text-gray-700 dark:text-[var(--brand-color-text)]',
  },
  onDark: {
    title: 'text-gray-900 dark:text-[var(--brand-color-text)]',
    body: 'text-gray-600 dark:text-[var(--brand-color-text-secondary)]',
    muted: 'text-gray-500 dark:text-[var(--brand-color-text-secondary)]',
  },
} as const;
