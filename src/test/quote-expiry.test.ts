import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BackgroundTask } from '@prisma/client';
import { executeBackgroundTask } from '@/lib/background-task-handlers';
import {
  customerCanAcceptQuote,
  customerCanDeclineQuote,
  effectiveInquiryStatus,
  quoteIsExpired,
  quoteValidUntilPassed,
} from '@/lib/quote-expiry';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

const now = new Date('2026-10-21T12:00:00.000Z');
const past = '2026-10-20T12:00:00.000Z';
const future = '2026-10-22T12:00:00.000Z';

describe('quote expiry helpers', () => {
  it('treats a missing or future validUntil as still open, and the exact instant as expired', () => {
    expect(quoteValidUntilPassed(null, now)).toBe(false);
    expect(quoteValidUntilPassed(future, now)).toBe(false);
    expect(quoteValidUntilPassed(now, now)).toBe(true);
    expect(quoteValidUntilPassed(past, now)).toBe(true);
  });

  it('derives an expired inquiry from a sent quote that is past validUntil or already expired', () => {
    expect(quoteIsExpired({ status: 'sent', validUntil: future }, now)).toBe(false);
    expect(quoteIsExpired({ status: 'sent', validUntil: past }, now)).toBe(true);
    expect(quoteIsExpired({ status: 'expired', validUntil: future }, now)).toBe(true);
    expect(quoteIsExpired({ status: 'accepted', validUntil: past }, now)).toBe(false);
    expect(effectiveInquiryStatus('quote_sent', { status: 'sent', validUntil: past }, now)).toBe('quote_expired');
    expect(effectiveInquiryStatus('quote_sent', { status: 'sent', validUntil: future }, now)).toBe('quote_sent');
    expect(effectiveInquiryStatus('declined', { status: 'expired', validUntil: past }, now)).toBe('declined');
  });

  it('lets a customer decline an expired quote and blocks acceptance', () => {
    const expired = { status: 'expired', validUntil: past };
    const due = { status: 'sent', validUntil: past };
    const open = { status: 'sent', validUntil: future };
    expect(customerCanDeclineQuote({ inquiryStatus: 'quote_sent', quote: expired })).toBe(true);
    expect(customerCanDeclineQuote({ inquiryStatus: 'quote_expired', quote: due })).toBe(true);
    expect(customerCanDeclineQuote({ inquiryStatus: 'quote_sent', quote: open })).toBe(true);
    expect(customerCanDeclineQuote({ inquiryStatus: 'quote_expired', quote: open, historical: true })).toBe(false);
    expect(customerCanDeclineQuote({ inquiryStatus: 'closed', quote: expired })).toBe(false);
    expect(customerCanAcceptQuote({ inquiryStatus: 'quote_sent', quote: open, now })).toBe(true);
    expect(customerCanAcceptQuote({ inquiryStatus: 'quote_sent', quote: due, now })).toBe(false);
    expect(customerCanAcceptQuote({ inquiryStatus: 'quote_expired', quote: due, now })).toBe(false);
    expect(customerCanAcceptQuote({ inquiryStatus: 'quote_sent', quote: expired, now })).toBe(false);
  });
});

describe('quote.expire background task', () => {
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => { clearAllTables(getTestDb()); });

  function seedQuote(validUntil: string, status = 'sent') {
    const db = getTestDb();
    db.prepare(`
      INSERT INTO Inquiry (id, name, email, phone, institution, status, createdAt, operationLogs)
      VALUES ('inq-1', '询价人', 'buyer@test.com', '13800000000', '实验室', 'quote_sent', datetime('now'), '[]')
    `).run();
    db.prepare(`
      INSERT INTO Quote (id, inquiryId, version, status, subtotal, currency, validUntil, sentAt, createdAt, updatedAt)
      VALUES ('q1', 'inq-1', 2, ?, 100, 'CNY', ?, ?, datetime('now'), datetime('now'))
    `).run(status, validUntil, validUntil);
  }

  function task(quoteId = 'q1'): BackgroundTask {
    return { type: 'quote.expire', payload: JSON.stringify({ quoteId }) } as BackgroundTask;
  }

  it('expires the quote and the inquiry, and does not notify twice', async () => {
    seedQuote(past);
    await expect(executeBackgroundTask(task())).resolves.toMatchObject({ expired: true, quoteId: 'q1' });

    const db = getTestDb();
    expect((db.prepare('SELECT status FROM Quote WHERE id = ?').get('q1') as { status: string }).status).toBe('expired');
    expect((db.prepare('SELECT status FROM Inquiry WHERE id = ?').get('inq-1') as { status: string }).status).toBe('quote_expired');
    const notes = db.prepare(`SELECT email, role, type, title, content FROM Notification`).all() as Array<{ email: string; role: string; type: string; title: string; content: string }>;
    expect(notes).toEqual([{
      email: 'buyer@test.com',
      role: 'customer',
      type: 'quote_expired',
      title: '报价已过期',
      content: '询价单的第 2 版报价已过期',
    }]);

    await expect(executeBackgroundTask(task())).resolves.toMatchObject({ skipped: 'quote_inactive' });
    expect((db.prepare('SELECT COUNT(*) AS count FROM Notification').get() as { count: number }).count).toBe(1);
    expect((db.prepare('SELECT status FROM Inquiry WHERE id = ?').get('inq-1') as { status: string }).status).toBe('quote_expired');
  });

  it('repairs an inquiry left on quote_sent after the quote was already expired', async () => {
    seedQuote(past, 'expired');
    await expect(executeBackgroundTask(task())).resolves.toMatchObject({ skipped: 'quote_inactive' });
    const db = getTestDb();
    expect((db.prepare('SELECT status FROM Inquiry WHERE id = ?').get('inq-1') as { status: string }).status).toBe('quote_expired');
    expect((db.prepare('SELECT COUNT(*) AS count FROM Notification').get() as { count: number }).count).toBe(0);
  });

  it('refuses to expire a quote before validUntil', async () => {
    seedQuote(future);
    await expect(executeBackgroundTask(task())).rejects.toThrow('Quote expiration task ran before validUntil');
    const db = getTestDb();
    expect((db.prepare('SELECT status FROM Quote WHERE id = ?').get('q1') as { status: string }).status).toBe('sent');
    expect((db.prepare('SELECT status FROM Inquiry WHERE id = ?').get('inq-1') as { status: string }).status).toBe('quote_sent');
  });
});
