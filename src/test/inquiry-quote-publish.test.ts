import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  QUOTABLE_INQUIRY_STATUSES,
  inquiryQuotePublishBlock,
  type InquiryQuotePublishFacts,
} from '@/lib/inquiry-status';
import { claimInquiryForQuotePublish } from '@/lib/inquiry-quote-publish';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

const openFacts = {
  archivedAt: null,
  orderCount: 0,
  acceptedQuoteCount: 0,
  orderedLineCount: 0,
} satisfies Omit<InquiryQuotePublishFacts, 'status'>;

describe('inquiryQuotePublishBlock', () => {
  it('allows pre-quote statuses, an unordered sent quote, and an expired inquiry', () => {
    for (const status of ['pending_quote', '待确认', '待人工审核', 'quote_sent', 'quote_expired'] as const) {
      expect(inquiryQuotePublishBlock({ ...openFacts, status })).toBeNull();
    }
  });

  it('blocks declined, closed, archived, ordered, and accepted inquiries', () => {
    expect(inquiryQuotePublishBlock({ ...openFacts, status: 'declined' })).toEqual({
      status: 409,
      code: 'INQUIRY_DECLINED',
      error: '询价已放弃，不能发布报价',
    });
    expect(inquiryQuotePublishBlock({ ...openFacts, status: 'closed' })).toMatchObject({
      code: 'INQUIRY_CLOSED',
      error: '询价已关闭，不能发布报价',
    });
    expect(inquiryQuotePublishBlock({ ...openFacts, status: 'quote_sent', archivedAt: '2026-10-21T00:00:00.000Z' })).toMatchObject({
      code: 'INQUIRY_ARCHIVED',
      error: '询价已归档，不能发布报价',
    });
    expect(inquiryQuotePublishBlock({ ...openFacts, status: 'quote_sent', orderCount: 1 })).toMatchObject({
      code: 'INQUIRY_ORDERED',
      error: '询价已下单，不能发布报价',
    });
    expect(inquiryQuotePublishBlock({ ...openFacts, status: 'pending_quote', orderedLineCount: 1 })).toMatchObject({
      error: '询价已下单，不能发布报价',
    });
    expect(inquiryQuotePublishBlock({ ...openFacts, status: 'quote_sent', acceptedQuoteCount: 1 })).toMatchObject({
      code: 'QUOTE_ACCEPTED',
      error: '报价已接受，不能发布报价',
    });
    expect(inquiryQuotePublishBlock({ ...openFacts, status: '处理中' })).toMatchObject({
      code: 'INQUIRY_NOT_QUOTABLE',
      error: '当前询价状态不能发布报价',
    });
  });

  it('keeps republish on quote_sent and quote_expired, and leaves terminal statuses out of the allowlist', () => {
    expect(QUOTABLE_INQUIRY_STATUSES).toEqual(['pending_quote', '待确认', '待人工审核', 'quote_sent', 'quote_expired']);
  });
});

describe('claimInquiryForQuotePublish', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => { clearAllTables(getTestDb()); });

  function seedInquiry(status: string, archived = false) {
    getTestDb().prepare(`
      INSERT INTO Inquiry (id, name, email, phone, institution, status, archivedAt, has_unresolved_pricing, createdAt, operationLogs)
      VALUES ('i1', '询价人', 'q@test.com', '13800000000', '清华大学', ?, ?, 1, datetime('now'), '[]')
    `).run(status, archived ? '2026-10-21 00:00:00' : null);
  }

  async function claim() {
    return prisma.$transaction((tx) => claimInquiryForQuotePublish(tx, 'i1'));
  }

  it('claims a pending inquiry and clears unresolved pricing', async () => {
    seedInquiry('pending_quote');
    expect(await claim()).toBe(1);
    expect(getTestDb().prepare('SELECT status, has_unresolved_pricing FROM Inquiry WHERE id = ?').get('i1')).toEqual({
      status: 'quote_sent',
      has_unresolved_pricing: 0,
    });
  });

  it('claims quote_expired and moves the inquiry back to quote_sent', async () => {
    seedInquiry('quote_expired');
    expect(await claim()).toBe(1);
    expect(getTestDb().prepare('SELECT status FROM Inquiry WHERE id = ?').get('i1')).toEqual({ status: 'quote_sent' });
  });

  it('claims quote_sent when the only quote is expired', async () => {
    seedInquiry('quote_sent');
    getTestDb().prepare(`
      INSERT INTO Quote (id, inquiryId, version, status, subtotal, currency, createdAt, updatedAt)
      VALUES ('q1', 'i1', 1, 'expired', 100, 'CNY', datetime('now'), datetime('now'))
    `).run();
    expect(await claim()).toBe(1);
    expect(getTestDb().prepare('SELECT status FROM Quote WHERE id = ?').get('q1')).toEqual({ status: 'expired' });
  });

  it('does not claim declined, archived, ordered, or accepted inquiries', async () => {
    seedInquiry('declined');
    expect(await claim()).toBe(0);
    expect(getTestDb().prepare('SELECT status, has_unresolved_pricing FROM Inquiry WHERE id = ?').get('i1')).toEqual({
      status: 'declined',
      has_unresolved_pricing: 1,
    });

    clearAllTables(getTestDb());
    seedInquiry('quote_sent', true);
    expect(await claim()).toBe(0);
    expect(getTestDb().prepare('SELECT status FROM Inquiry WHERE id = ?').get('i1')).toEqual({ status: 'quote_sent' });

    clearAllTables(getTestDb());
    seedInquiry('quote_sent');
    getTestDb().prepare(`
      INSERT INTO "Order" (id, inquiryId, email, subtotal, total, status, shippingMethod, operationLogs, createdAt, updatedAt)
      VALUES ('o1', 'i1', 'q@test.com', 100, 100, 'confirmed', 'logistics', '[]', datetime('now'), datetime('now'))
    `).run();
    expect(await claim()).toBe(0);
    expect(getTestDb().prepare('SELECT status FROM Inquiry WHERE id = ?').get('i1')).toEqual({ status: 'quote_sent' });

    clearAllTables(getTestDb());
    seedInquiry('quote_sent');
    getTestDb().prepare(`
      INSERT INTO Quote (id, inquiryId, version, status, subtotal, currency, createdAt, updatedAt)
      VALUES ('q-acc', 'i1', 1, 'accepted', 100, 'CNY', datetime('now'), datetime('now'))
    `).run();
    expect(await claim()).toBe(0);
    expect(getTestDb().prepare('SELECT status FROM Inquiry WHERE id = ?').get('i1')).toEqual({ status: 'quote_sent' });

    clearAllTables(getTestDb());
    seedInquiry('quote_sent');
    getTestDb().prepare(`
      INSERT INTO Quote (id, inquiryId, version, status, subtotal, currency, createdAt, updatedAt)
      VALUES ('q-part', 'i1', 1, 'sent', 100, 'CNY', datetime('now'), datetime('now'))
    `).run();
    getTestDb().prepare(`
      INSERT INTO QuoteItem (id, quoteId, position, name, unitPrice, quantity, orderedQty, lineTotal, createdAt, updatedAt)
      VALUES ('qi1', 'q-part', 0, 'A', 100, 2, 1, 200, datetime('now'), datetime('now'))
    `).run();
    expect(await claim()).toBe(0);
    expect(getTestDb().prepare('SELECT status FROM Quote WHERE id = ?').get('q-part')).toEqual({ status: 'sent' });
  });
});
