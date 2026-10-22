export const QUOTE_DECLINE_NOTE_MAX = 500;

export const QUOTE_DECLINE_REASONS = [
  { code: 'price_high', label: '价格偏高，需要再考虑' },
  { code: 'plans_changed', label: '计划有变' },
  { code: 'other', label: '其他' },
] as const;

export type QuoteDeclineReasonCode = (typeof QUOTE_DECLINE_REASONS)[number]['code'];

const REASON_CODES = new Set<string>(QUOTE_DECLINE_REASONS.map((reason) => reason.code));

export function quoteDeclineReasonLabel(code: string | null | undefined): string {
  return QUOTE_DECLINE_REASONS.find((reason) => reason.code === code)?.label ?? '';
}

export function isQuoteDeclineReasonCode(value: unknown): value is QuoteDeclineReasonCode {
  return typeof value === 'string' && REASON_CODES.has(value);
}

export type ParsedQuoteDecline =
  | { ok: true; reasonCode: QuoteDeclineReasonCode; note: string | null }
  | { ok: false; error: string };

export function parseQuoteDeclineInput(reasonCode: unknown, note: unknown): ParsedQuoteDecline {
  if (!isQuoteDeclineReasonCode(reasonCode)) {
    return { ok: false, error: '请选择放弃原因' };
  }
  if (note != null && typeof note !== 'string') {
    return { ok: false, error: '补充说明格式无效' };
  }
  const trimmed = typeof note === 'string' ? note.trim() : '';
  if (trimmed.length > QUOTE_DECLINE_NOTE_MAX) {
    return { ok: false, error: `补充说明不能超过 ${QUOTE_DECLINE_NOTE_MAX} 字` };
  }
  if (reasonCode === 'other' && trimmed.length === 0) {
    return { ok: false, error: '选择「其他」时请填写说明' };
  }
  return { ok: true, reasonCode, note: trimmed.length > 0 ? trimmed : null };
}
