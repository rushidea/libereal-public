import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'admin_test_id', email: 'admin@test.com', name: 'Admin', role: 'admin', sessionId: 'session-1' },
  }),
}));

import { PATCH as inquiryPATCH } from '@/app/api/inquiries/[id]/route';
import { NextRequest } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

function seedInquiry(status: string) {
  getTestDb().prepare(`
    INSERT INTO Inquiry (id, name, email, phone, institution, status, notes, createdAt, operationLogs)
    VALUES ('i1', '询价人', 'buyer@test.com', '13800000000', '实验室', ?, '原备注', datetime('now'), '[]')
  `).run(status);
}

function seedQuote(status: string, version = 1) {
  getTestDb().prepare(`
    INSERT INTO Quote (id, inquiryId, version, status, subtotal, createdAt, updatedAt)
    VALUES (?, 'i1', ?, ?, 100, datetime('now'), datetime('now'))
  `).run(`q${version}`, version, status);
}

function patch(body: unknown) {
  return inquiryPATCH(new NextRequest('http://localhost:3000/api/inquiries/i1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: 'i1' }) });
}

function stored() {
  return getTestDb().prepare('SELECT status, notes FROM Inquiry WHERE id = ?').get('i1') as { status: string; notes: string };
}

describe('PATCH /api/inquiries/[id] status', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    clearAllTables(getTestDb());
    seedAdmin(getTestDb());
  });

  it('rejects an arbitrary status and does not write the rest of the request', async () => {
    seedInquiry('pending_quote');
    const response = await patch({ status: '<script>alert(1)</script>', notes: '被篡改' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/询价状态无效/) });
    expect(stored()).toEqual({ status: 'pending_quote', notes: '原备注' });
    expect(getTestDb().prepare('SELECT COUNT(*) AS count FROM Notification').get()).toEqual({ count: 0 });
  });

  it('rejects the quote status expired and does not move an expired quote back to intake', async () => {
    seedInquiry('quote_sent');
    seedQuote('expired');
    const expired = await patch({ status: 'expired' });
    expect(expired.status).toBe(400);
    await expect(expired.json()).resolves.toMatchObject({ error: expect.stringMatching(/询价状态无效/) });

    const backward = await patch({ status: 'pending_quote' });
    expect(backward.status).toBe(400);
    await expect(backward.json()).resolves.toMatchObject({
      error: '询价不能从「已发报价」改为「待报价」。',
    });
    expect(stored().status).toBe('quote_sent');
  });

  it('rejects skipping quote, decline, and accept', async () => {
    seedInquiry('待确认');
    const declined = await patch({ status: 'declined' });
    expect(declined.status).toBe(400);
    await expect(declined.json()).resolves.toMatchObject({ error: '询价不能从「待确认」改为「已放弃」。' });

    seedQuote('sent');
    const quoted = await patch({ status: 'quote_sent' });
    expect(quoted.status).toBe(200);

    getTestDb().prepare(`UPDATE Inquiry SET status = 'quote_sent' WHERE id = 'i1'`).run();
    const abandonOpenQuote = await patch({ status: 'declined' });
    expect(abandonOpenQuote.status).toBe(400);
    await expect(abandonOpenQuote.json()).resolves.toMatchObject({ error: '报价尚未放弃，不能把询价改为已放弃。' });

    const closeOpenQuote = await patch({ status: 'closed' });
    expect(closeOpenQuote.status).toBe(400);
    await expect(closeOpenQuote.json()).resolves.toMatchObject({ error: '报价尚未接受，不能关闭询价。' });
    expect(stored().status).toBe('quote_sent');
  });

  it('rejects quoting when the latest quote is not sent', async () => {
    seedInquiry('pending_quote');
    const missing = await patch({ status: 'quote_sent' });
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ error: '当前没有已发送的报价，不能改为已发报价。' });

    seedQuote('sent', 1);
    seedQuote('expired', 2);
    const expiredLatest = await patch({ status: 'quote_sent' });
    expect(expiredLatest.status).toBe(400);
    await expect(expiredLatest.json()).resolves.toMatchObject({ error: '当前没有已发送的报价，不能改为已发报价。' });
    expect(stored().status).toBe('pending_quote');
  });

  it('allows intake reclassification and aligning status with the latest quote', async () => {
    seedInquiry('待确认');
    const review = await patch({ status: '待人工审核' });
    expect(review.status).toBe(200);
    expect(stored().status).toBe('待人工审核');
    const reviewNotice = getTestDb().prepare('SELECT content FROM Notification').get() as { content: string };
    expect(reviewNotice.content).toBe('您的询价单状态已更新为：待人工审核');

    seedQuote('expired', 1);
    seedQuote('sent', 2);
    const quoted = await patch({ status: 'quote_sent' });
    expect(quoted.status).toBe(200);
    expect(stored().status).toBe('quote_sent');

    getTestDb().prepare(`UPDATE Quote SET status = 'declined' WHERE id = 'q2'`).run();
    const declined = await patch({ status: 'declined' });
    expect(declined.status).toBe(200);
    expect(stored().status).toBe('declined');

    const terminal = await patch({ status: 'quote_sent' });
    expect(terminal.status).toBe(400);
    await expect(terminal.json()).resolves.toMatchObject({ error: '询价不能从「已放弃」改为「已发报价」。' });
    expect(stored().status).toBe('declined');
  });

  it('aligns quote_sent with an expired quote, then with a later sent or declined quote', async () => {
    seedInquiry('quote_sent');
    seedQuote('sent');
    const tooSoon = await patch({ status: 'quote_expired' });
    expect(tooSoon.status).toBe(400);
    await expect(tooSoon.json()).resolves.toMatchObject({ error: '报价尚未过期，不能把询价改为已过期。' });

    seedQuote('expired', 2);
    const expired = await patch({ status: 'quote_expired' });
    expect(expired.status).toBe(200);
    expect(stored().status).toBe('quote_expired');
    const notice = getTestDb().prepare('SELECT content FROM Notification').get() as { content: string };
    expect(notice.content).toBe('您的询价单状态已更新为：已过期');

    const stillOpen = await patch({ status: 'declined' });
    expect(stillOpen.status).toBe(400);
    await expect(stillOpen.json()).resolves.toMatchObject({ error: '报价尚未放弃，不能把询价改为已放弃。' });
    const requoteBlocked = await patch({ status: 'quote_sent' });
    expect(requoteBlocked.status).toBe(400);
    await expect(requoteBlocked.json()).resolves.toMatchObject({ error: '当前没有已发送的报价，不能改为已发报价。' });

    seedQuote('sent', 3);
    const requoted = await patch({ status: 'quote_sent' });
    expect(requoted.status).toBe(200);
    expect(stored().status).toBe('quote_sent');

    getTestDb().prepare(`UPDATE Inquiry SET status = 'quote_expired' WHERE id = 'i1'`).run();
    getTestDb().prepare(`UPDATE Quote SET status = 'declined' WHERE id = 'q3'`).run();
    const declined = await patch({ status: 'declined' });
    expect(declined.status).toBe(200);
    expect(stored().status).toBe('declined');
  });

  it('allows closing only after the latest quote is accepted, and still saves fields without status', async () => {
    seedInquiry('quote_sent');
    seedQuote('accepted');
    const closed = await patch({ status: 'closed' });
    expect(closed.status).toBe(200);
    expect(stored().status).toBe('closed');
    const notice = getTestDb().prepare('SELECT content FROM Notification ORDER BY createdAt DESC').get() as { content: string };
    expect(notice.content).toContain('已关闭');

    const notes = await patch({ notes: '只改备注' });
    expect(notes.status).toBe(200);
    expect(stored()).toEqual({ status: 'closed', notes: '只改备注' });
  });
});
