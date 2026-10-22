export const INQUIRY_DRAFT_STORAGE_KEY = 'libereal-inquiry-draft';

export type InquiryConfirmedItemDraft = {
  name: string;
  brand: string;
  catalogNumber: string;
  quantity: number;
  unit: string;
  maxLeadTime: string;
  isQuickOrder?: boolean;
  itemId: string;
};

export type InquiryContactDraft = {
  name: string;
  email: string;
  phone: string;
  institution: string;
  department: string;
  address: string;
};

export const EMPTY_INQUIRY_CONTACT: InquiryContactDraft = {
  name: '',
  email: '',
  phone: '',
  institution: '',
  department: '',
  address: '',
};

export type InquiryFormDraft = {
  step?: 'confirm' | 'form';
  confirmedItems?: InquiryConfirmedItemDraft[];
  paymentMethod?: string;
  notes?: string;
  contact?: InquiryContactDraft;
  leadTimes?: Record<string, string>;
};

const CONTACT_FIELDS = ['name', 'email', 'phone', 'institution', 'department', 'address'] as const;

export function normalizeInquiryContact(value: Partial<InquiryContactDraft> | null | undefined): InquiryContactDraft {
  const next = { ...EMPTY_INQUIRY_CONTACT };
  if (!value || typeof value !== 'object') return next;
  for (const field of CONTACT_FIELDS) {
    const raw = value[field];
    next[field] = typeof raw === 'string' ? raw : '';
  }
  return next;
}

/**
 * Keep a non-empty profile value. Use the restored draft only when that
 * profile field is empty.
 */
export function mergeInquiryContact(
  profile: InquiryContactDraft,
  draft?: Partial<InquiryContactDraft> | null,
): InquiryContactDraft {
  const saved = normalizeInquiryContact(draft);
  const next = { ...EMPTY_INQUIRY_CONTACT };
  for (const field of CONTACT_FIELDS) {
    const fromProfile = profile[field]?.trim() || '';
    next[field] = fromProfile || saved[field].trim();
  }
  return next;
}

export function normalizeInquiryLeadTimes(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const next: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d+$/.test(key) || typeof entry !== 'string') continue;
    next[key] = entry;
  }
  return next;
}

export function leadTimesForDraft(
  value: Record<string, string> | Record<number, string> | null | undefined,
): Record<string, string> | undefined {
  const normalized = normalizeInquiryLeadTimes(value);
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function readInquiryDraft(): InquiryFormDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(INQUIRY_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InquiryFormDraft;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeInquiryDraft(draft: InquiryFormDraft): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(INQUIRY_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // ignore quota / private mode
  }
}

export function clearInquiryDraft(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(INQUIRY_DRAFT_STORAGE_KEY);
  } catch {
    // ignore
  }
}
