import { describe, expect, it } from 'vitest';
import {
  INQUIRY_STATUS_LABELS,
  INQUIRY_STATUSES,
  PENDING_INQUIRY_STATUSES,
  inquiryQuoteAcceptBlock,
  inquiryStatusTransitionError,
} from '@/lib/inquiry-status';
import { QUOTE_EXPIRED_INQUIRY_STATUS } from '@/lib/quote-expiry';

const intake = PENDING_INQUIRY_STATUSES;

describe('inquiryStatusTransitionError', () => {
  it('allows reclassifying intake statuses and repeating the current status', () => {
    for (const from of intake) {
      for (const to of intake) {
        expect(inquiryStatusTransitionError(from, to, null)).toBeNull();
      }
      expect(inquiryStatusTransitionError(from, from, 'expired')).toBeNull();
    }
    expect(inquiryStatusTransitionError('quote_sent', 'quote_sent', 'expired')).toBeNull();
    expect(inquiryStatusTransitionError('quote_expired', 'quote_expired', 'expired')).toBeNull();
    expect(inquiryStatusTransitionError('declined', 'declined', 'declined')).toBeNull();
    expect(inquiryStatusTransitionError('closed', 'closed', 'accepted')).toBeNull();
  });

  it('follows quote, decline, accept, and expiry rules', () => {
    for (const from of intake) {
      expect(inquiryStatusTransitionError(from, 'quote_sent', 'sent')).toBeNull();
      expect(inquiryStatusTransitionError(from, 'quote_sent', null)).toMatch(/没有已发送的报价/);
      expect(inquiryStatusTransitionError(from, 'quote_sent', 'expired')).toMatch(/没有已发送的报价/);
      expect(inquiryStatusTransitionError(from, 'quote_sent', 'draft')).toMatch(/没有已发送的报价/);
      expect(inquiryStatusTransitionError(from, 'declined', 'declined')).toMatch(/不能从「.+」改为「已放弃」/);
      expect(inquiryStatusTransitionError(from, 'closed', 'accepted')).toMatch(/不能从「.+」改为「已关闭」/);
    }

    expect(inquiryStatusTransitionError('quote_sent', 'declined', 'declined')).toBeNull();
    expect(inquiryStatusTransitionError('quote_sent', 'declined', 'sent')).toMatch(/报价尚未放弃/);
    expect(inquiryStatusTransitionError('quote_sent', 'declined', 'expired')).toMatch(/报价尚未放弃/);
    expect(inquiryStatusTransitionError('quote_sent', 'closed', 'accepted')).toBeNull();
    expect(inquiryStatusTransitionError('quote_sent', 'closed', 'sent')).toMatch(/报价尚未接受/);
    expect(inquiryStatusTransitionError('quote_sent', 'closed', 'expired')).toMatch(/报价尚未接受/);
    expect(inquiryStatusTransitionError('quote_sent', 'pending_quote', 'expired')).toMatch(/不能从「已发报价」改为「待报价」/);
    expect(inquiryStatusTransitionError('declined', 'quote_sent', 'sent')).toMatch(/不能从「已放弃」改为「已发报价」/);
    expect(inquiryStatusTransitionError('closed', 'pending_quote', null)).toMatch(/不能从「已关闭」改为「待报价」/);
  });

  it('lets an expired quote move between quote_sent, quote_expired, and declined', () => {
    expect(INQUIRY_STATUS_LABELS.quote_expired).toBe('已过期');
    expect(INQUIRY_STATUSES).toContain(QUOTE_EXPIRED_INQUIRY_STATUS);
    expect(inquiryStatusTransitionError('quote_sent', 'quote_expired', 'expired')).toBeNull();
    expect(inquiryStatusTransitionError('quote_sent', 'quote_expired', 'sent')).toBe('报价尚未过期，不能把询价改为已过期。');
    expect(inquiryStatusTransitionError('quote_sent', 'quote_expired', null)).toBe('报价尚未过期，不能把询价改为已过期。');
    expect(inquiryStatusTransitionError('quote_expired', 'declined', 'declined')).toBeNull();
    expect(inquiryStatusTransitionError('quote_expired', 'declined', 'expired')).toBe('报价尚未放弃，不能把询价改为已放弃。');
    expect(inquiryStatusTransitionError('quote_expired', 'quote_sent', 'sent')).toBeNull();
    expect(inquiryStatusTransitionError('quote_expired', 'quote_sent', 'expired')).toBe('当前没有已发送的报价，不能改为已发报价。');
    expect(inquiryStatusTransitionError('quote_expired', 'pending_quote', 'expired')).toBe('询价不能从「已过期」改为「待报价」。');
    expect(inquiryStatusTransitionError('quote_expired', 'closed', 'accepted')).toBe('询价不能从「已过期」改为「已关闭」。');
    expect(inquiryStatusTransitionError('pending_quote', 'quote_expired', 'expired')).toBe('询价不能从「待报价」改为「已过期」。');
  });

  it('rejects values outside the inquiry status enum, including quote-only statuses', () => {
    for (const value of ['expired', '已确认', '已拒绝', '处理中', '已报价', '已完成', 'pwned', ' quote_sent', '']) {
      expect(inquiryStatusTransitionError('pending_quote', value, 'sent')).toMatch(/询价状态无效/);
    }
    expect(inquiryStatusTransitionError('pending_quote', 1, null)).toMatch(/询价状态无效/);
    expect(inquiryStatusTransitionError('pending_quote', { status: 'closed' }, null)).toMatch(/询价状态无效/);
    expect(inquiryStatusTransitionError('已确认', 'pending_quote', null)).toMatch(/不在可流转范围内/);
    expect(INQUIRY_STATUSES).not.toContain('expired');
  });
});

describe('inquiryQuoteAcceptBlock', () => {
  it('allows another confirmation only while the inquiry is quote_sent and not archived', () => {
    expect(inquiryQuoteAcceptBlock({ status: 'quote_sent', archivedAt: null })).toBeNull();
  });

  it('blocks declined, closed, archived, and any other status', () => {
    expect(inquiryQuoteAcceptBlock({ status: 'declined', archivedAt: null })).toMatchObject({ code: 'INQUIRY_DECLINED' });
    expect(inquiryQuoteAcceptBlock({ status: 'closed', archivedAt: null })).toMatchObject({ code: 'INQUIRY_CLOSED' });
    expect(inquiryQuoteAcceptBlock({ status: 'quote_sent', archivedAt: '2026-10-22T00:00:00.000Z' })).toMatchObject({ code: 'INQUIRY_ARCHIVED' });
    expect(inquiryQuoteAcceptBlock({ status: 'quote_expired', archivedAt: null })).toMatchObject({ code: 'INQUIRY_NOT_ACCEPTABLE' });
    expect(inquiryQuoteAcceptBlock({ status: 'pending_quote', archivedAt: null })).toMatchObject({ code: 'INQUIRY_NOT_ACCEPTABLE' });
  });
});
