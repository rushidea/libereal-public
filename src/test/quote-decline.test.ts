import { describe, expect, it } from 'vitest';
import { PENDING_INQUIRY_STATUSES } from '@/lib/inquiry-status';
import { parseQuoteDeclineInput, QUOTE_DECLINE_NOTE_MAX, quoteDeclineReasonLabel } from '@/lib/quote-decline';

describe('parseQuoteDeclineInput', () => {
  it('accepts a known reason and an optional note', () => {
    expect(parseQuoteDeclineInput('price_high', '  再看看预算  ')).toEqual({
      ok: true,
      reasonCode: 'price_high',
      note: '再看看预算',
    });
    expect(parseQuoteDeclineInput('plans_changed', '')).toEqual({
      ok: true,
      reasonCode: 'plans_changed',
      note: null,
    });
  });

  it('requires a note when the reason is 其他', () => {
    expect(parseQuoteDeclineInput('other', '   ')).toEqual({ ok: false, error: '选择「其他」时请填写说明' });
    expect(parseQuoteDeclineInput('other', '改用其他供应商')).toEqual({
      ok: true,
      reasonCode: 'other',
      note: '改用其他供应商',
    });
  });

  it('rejects unknown reasons, non-string notes, and notes over 500 characters', () => {
    expect(parseQuoteDeclineInput('too_expensive', null).ok).toBe(false);
    expect(parseQuoteDeclineInput('price_high', 12).ok).toBe(false);
    expect(parseQuoteDeclineInput('price_high', 'a'.repeat(QUOTE_DECLINE_NOTE_MAX + 1))).toEqual({
      ok: false,
      error: '补充说明不能超过 500 字',
    });
    expect(parseQuoteDeclineInput('price_high', 'a'.repeat(QUOTE_DECLINE_NOTE_MAX)).ok).toBe(true);
  });

  it('maps reason codes to the customer-facing labels', () => {
    expect(quoteDeclineReasonLabel('price_high')).toBe('价格偏高，需要再考虑');
    expect(quoteDeclineReasonLabel('plans_changed')).toBe('计划有变');
    expect(quoteDeclineReasonLabel('other')).toBe('其他');
  });
});

describe('pending inquiry badge statuses', () => {
  it('does not count declined inquiries as pending', () => {
    expect(PENDING_INQUIRY_STATUSES).not.toContain('declined');
    expect(PENDING_INQUIRY_STATUSES).not.toContain('quote_sent');
    expect(PENDING_INQUIRY_STATUSES).not.toContain('quote_expired');
    expect(PENDING_INQUIRY_STATUSES).toContain('pending_quote');
  });
});
