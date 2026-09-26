export type SupportTab = 'protocols' | 'buffers' | 'faqs' | 'calculators' | 'spectra' | 'cd-markers';

export const VALID_SUPPORT_TABS: SupportTab[] = ['protocols', 'buffers', 'faqs', 'calculators', 'spectra', 'cd-markers'];

export function isSupportTab(value: string | null): value is SupportTab {
  return value !== null && VALID_SUPPORT_TABS.includes(value as SupportTab);
}
