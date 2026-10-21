import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireOrganizationPermission } = vi.hoisted(() => ({
  requireOrganizationPermission: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/organization-service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/organization-service')>('@/lib/organization-service');
  return { ...actual, requireOrganizationPermission };
});

import { auth } from '@/lib/auth';
import { OrganizationRbacError } from '@/lib/organization-service';
import { POST as declinePOST } from '@/app/api/inquiries/[id]/decline/route';
import { GET as inquiriesGET } from '@/app/api/inquiries/route';
import { pendingInquiryWhere } from '@/lib/inquiry-status';
import { prisma } from '@/lib/prisma';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

function seedInquiry(db: ReturnType<typeof getTestDb>, inquiry: { id: string; name: string; email: string; status?: string }) {
  db.prepare(`
    INSERT INTO Inquiry (id, name, email, phone, institution, status, archivedAt, createdAt, operationLogs)
    VALUES (?, ?, ?, '13800000000', '清华大学', ?, NULL, datetime('now'), '[]')
  `).run(inquiry.id, inquiry.name, inquiry.email, inquiry.status ?? 'pending_quote');
}

const authMock = auth as unknown as {
  mockResolvedValue: (value: { user: { id: string; email: string; name: string; role: string; sessionId?: string } } | null) => void;
};

function asUser(user: { id: string; email: string; role?: string; sessionId?: string | null }) {
  authMock.mockResolvedValue({
    user: {
      id: user.id,
      email: user.email,
      name: user.email,
      role: user.role ?? 'customer',
      ...(user.sessionId === null ? {} : { sessionId: user.sessionId ?? `session-${user.id}` }),
    },
  });
}

function declineRequest(id: string, body: unknown) {
  return new NextRequest(`http://localhost:3000/api/inquiries/${id}/decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function seedSentQuote(quoteId = 'q1', inquiryId = 'inq-1') {
  const db = getTestDb();
  db.prepare(`
    INSERT INTO Quote (id, inquiryId, version, status, subtotal, currency, sentAt, createdAt, updatedAt)
    VALUES (?, ?, 1, 'sent', 100, 'CNY', datetime('now'), datetime('now'), datetime('now'))
  `).run(quoteId, inquiryId);
  db.prepare(`UPDATE Inquiry SET status = 'quote_sent' WHERE id = ?`).run(inquiryId);
}

describe('POST /api/inquiries/[id]/decline', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, { id: 'owner-1', email: 'owner@test.com', name: '所有者' });
    seedUser(db, { id: 'other-1', email: 'other@test.com', name: '其他人' });
    seedInquiry(db, { id: 'inq-1', name: '所有者', email: 'owner@test.com', status: 'quote_sent' });
    seedInquiry(db, { id: 'inq-pending', name: '待报价', email: 'owner@test.com', status: 'pending_quote' });
    seedSentQuote();
    requireOrganizationPermission.mockReset();
    asUser({ id: 'owner-1', email: 'owner@test.com' });
  });

  it('records the decline for the owner and excludes it from the pending badge count', async () => {
    const response = await declinePOST(
      declineRequest('inq-1', { reasonCode: 'price_high', note: ' 预算不够 ', quoteId: 'q1', declinedByUserId: 'someone-else' }),
      { params: Promise.resolve({ id: 'inq-1' }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      inquiryStatus: 'declined',
      quoteStatus: 'declined',
      quoteId: 'q1',
      reasonCode: 'price_high',
      note: '预算不够',
    });

    const db = getTestDb();
    const inquiry = db.prepare('SELECT status FROM Inquiry WHERE id = ?').get('inq-1') as { status: string };
    expect(inquiry.status).toBe('declined');
    const quote = db.prepare('SELECT status, declineReasonCode, declineNote, declinedAt, declinedByUserId, declinedByEmail FROM Quote WHERE id = ?').get('q1') as {
      status: string; declineReasonCode: string; declineNote: string; declinedAt: string; declinedByUserId: string; declinedByEmail: string;
    };
    expect(quote.status).toBe('declined');
    expect(quote.declineReasonCode).toBe('price_high');
    expect(quote.declineNote).toBe('预算不够');
    expect(quote.declinedAt).toBeTruthy();
    expect(quote.declinedByUserId).toBe('owner-1');
    expect(quote.declinedByEmail).toBe('owner@test.com');
    const confirmation = db.prepare('SELECT action, email, userId, details FROM QuoteConfirmation').get() as {
      action: string; email: string; userId: string; details: string;
    };
    expect(confirmation).toMatchObject({ action: 'decline', email: 'owner@test.com', userId: 'owner-1' });
    expect(JSON.parse(confirmation.details)).toEqual({ reasonCode: 'price_high', note: '预算不够' });
    const notification = db.prepare(`SELECT email, role, type, title, content FROM Notification WHERE type = 'quote_declined'`).get() as {
      email: string; role: string; type: string; title: string; content: string;
    };
    expect(notification).toMatchObject({ email: 'admin', role: 'admin', type: 'quote_declined', title: '客户已放弃报价' });
    expect(notification.content).toContain('价格偏高，需要再考虑');
    expect(notification.content).toContain('预算不够');

    const pending = await prisma.inquiry.count({ where: pendingInquiryWhere() });
    expect(pending).toBe(1);

    asUser({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin' });
    const list = await inquiriesGET(new NextRequest('http://localhost:3000/api/inquiries'));
    expect(list.status).toBe(200);
    const rows = await list.json() as Array<{ id: string; activeQuote: { declineReasonCode: string; declineNote: string; declinedByEmail: string; status: string } | null }>;
    expect(rows.find((row) => row.id === 'inq-1')?.activeQuote).toMatchObject({
      status: 'declined',
      declineReasonCode: 'price_high',
      declineNote: '预算不够',
      declinedByEmail: 'owner@test.com',
    });
  });

  it('requires a note for 其他 and rejects an oversized note', async () => {
    const missing = await declinePOST(declineRequest('inq-1', { reasonCode: 'other', note: '  ' }), { params: Promise.resolve({ id: 'inq-1' }) });
    expect(missing.status).toBe(400);
    const tooLong = await declinePOST(
      declineRequest('inq-1', { reasonCode: 'plans_changed', note: '字'.repeat(501) }),
      { params: Promise.resolve({ id: 'inq-1' }) },
    );
    expect(tooLong.status).toBe(400);
    const inquiry = getTestDb().prepare('SELECT status FROM Inquiry WHERE id = ?').get('inq-1') as { status: string };
    expect(inquiry.status).toBe('quote_sent');
  });

  it('declines a quote that is already expired and one that is sent but past validUntil', async () => {
    const db = getTestDb();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    db.prepare(`UPDATE Quote SET status = 'expired', validUntil = ? WHERE id = 'q1'`).run(past);
    db.prepare(`UPDATE Inquiry SET status = 'quote_sent' WHERE id = 'inq-1'`).run();

    const expired = await declinePOST(
      declineRequest('inq-1', { reasonCode: 'plans_changed', quoteId: 'q1' }),
      { params: Promise.resolve({ id: 'inq-1' }) },
    );
    expect(expired.status).toBe(200);
    await expect(expired.json()).resolves.toMatchObject({ success: true, inquiryStatus: 'declined', quoteStatus: 'declined' });
    expect((db.prepare('SELECT status FROM Inquiry WHERE id = ?').get('inq-1') as { status: string }).status).toBe('declined');
    expect((db.prepare('SELECT status FROM Quote WHERE id = ?').get('q1') as { status: string }).status).toBe('declined');

    db.prepare(`UPDATE Inquiry SET status = 'quote_expired' WHERE id = 'inq-pending'`).run();
    db.prepare(`
      INSERT INTO Quote (id, inquiryId, version, status, subtotal, currency, validUntil, sentAt, createdAt, updatedAt)
      VALUES ('q-due', 'inq-pending', 1, 'sent', 50, 'CNY', ?, ?, datetime('now'), datetime('now'))
    `).run(past, past);
    const due = await declinePOST(
      declineRequest('inq-pending', { reasonCode: 'price_high', note: '过期了' }),
      { params: Promise.resolve({ id: 'inq-pending' }) },
    );
    expect(due.status).toBe(200);
    await expect(due.json()).resolves.toMatchObject({ success: true, inquiryStatus: 'declined', quoteId: 'q-due' });
    expect((db.prepare('SELECT status FROM Quote WHERE id = ?').get('q-due') as { status: string }).status).toBe('declined');
  });

  it('rejects a second decline, another customer, an admin who does not own it, and a missing session', async () => {
    const first = await declinePOST(declineRequest('inq-1', { reasonCode: 'plans_changed' }), { params: Promise.resolve({ id: 'inq-1' }) });
    expect(first.status).toBe(200);
    const second = await declinePOST(declineRequest('inq-1', { reasonCode: 'plans_changed' }), { params: Promise.resolve({ id: 'inq-1' }) });
    expect(second.status).toBe(409);

    seedSentQuote('q-other', 'inq-pending');
    getTestDb().prepare(`UPDATE Inquiry SET status = 'quote_sent', email = 'owner@test.com' WHERE id = 'inq-pending'`).run();
    asUser({ id: 'other-1', email: 'other@test.com' });
    const foreign = await declinePOST(declineRequest('inq-pending', { reasonCode: 'plans_changed' }), { params: Promise.resolve({ id: 'inq-pending' }) });
    expect(foreign.status).toBe(403);
    await expect(foreign.json()).resolves.toMatchObject({ error: '无权操作此询价', code: 'FORBIDDEN' });

    asUser({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin' });
    const admin = await declinePOST(declineRequest('inq-pending', { reasonCode: 'plans_changed' }), { params: Promise.resolve({ id: 'inq-pending' }) });
    expect(admin.status).toBe(403);
    expect(requireOrganizationPermission).not.toHaveBeenCalled();

    authMock.mockResolvedValue(null);
    const anonymous = await declinePOST(declineRequest('inq-pending', { reasonCode: 'plans_changed' }), { params: Promise.resolve({ id: 'inq-pending' }) });
    expect(anonymous.status).toBe(401);
    const stillSent = getTestDb().prepare('SELECT status FROM Quote WHERE id = ?').get('q-other') as { status: string };
    expect(stillSent.status).toBe('sent');
  });

  it('does not decline an accepted quote or a quote that already created an order', async () => {
    const db = getTestDb();
    db.prepare(`UPDATE Quote SET status = 'accepted' WHERE id = 'q1'`).run();
    db.prepare(`UPDATE Inquiry SET status = 'closed' WHERE id = 'inq-1'`).run();
    const accepted = await declinePOST(
      declineRequest('inq-1', { reasonCode: 'price_high', status: 'declined' }),
      { params: Promise.resolve({ id: 'inq-1' }) },
    );
    expect(accepted.status).toBe(409);

    db.prepare(`UPDATE Quote SET status = 'sent' WHERE id = 'q1'`).run();
    db.prepare(`UPDATE Inquiry SET status = 'quote_sent' WHERE id = 'inq-1'`).run();
    db.prepare(`
      INSERT INTO "Order" (id, inquiryId, email, subtotal, total, status, createdAt, updatedAt)
      VALUES ('ord-1', 'inq-1', 'owner@test.com', 100, 100, 'pending', datetime('now'), datetime('now'))
    `).run();
    const converted = await declinePOST(declineRequest('inq-1', { reasonCode: 'price_high', quoteId: 'q1' }), { params: Promise.resolve({ id: 'inq-1' }) });
    expect(converted.status).toBe(409);
    const quote = db.prepare('SELECT status FROM Quote WHERE id = ?').get('q1') as { status: string };
    expect(quote.status).toBe('sent');
  });

  it('rejects a stale quote id and a quote that already has ordered quantity', async () => {
    const stale = await declinePOST(declineRequest('inq-1', { reasonCode: 'price_high', quoteId: 'other-quote' }), { params: Promise.resolve({ id: 'inq-1' }) });
    expect(stale.status).toBe(409);
    const db = getTestDb();
    db.prepare(`
      INSERT INTO QuoteItem (id, quoteId, position, name, unitPrice, quantity, orderedQty, lineTotal, createdAt, updatedAt)
      VALUES ('qi-1', 'q1', 0, 'A', 100, 1, 1, 100, datetime('now'), datetime('now'))
    `).run();
    const partial = await declinePOST(declineRequest('inq-1', { reasonCode: 'price_high', quoteId: 'q1' }), { params: Promise.resolve({ id: 'inq-1' }) });
    expect(partial.status).toBe(409);
    const quote = db.prepare('SELECT status FROM Quote WHERE id = ?').get('q1') as { status: string };
    expect(quote.status).toBe('sent');
  });

  it('allows decline when inquiry.userId matches even if the stored email differs', async () => {
    const db = getTestDb();
    db.prepare(`UPDATE Inquiry SET userId = 'owner-1', email = 'legacy@example.com' WHERE id = 'inq-1'`).run();
    const response = await declinePOST(
      declineRequest('inq-1', { reasonCode: 'plans_changed' }),
      { params: Promise.resolve({ id: 'inq-1' }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, inquiryStatus: 'declined' });
  });

  it('allows decline when verified mailbox matches inquiry email case-insensitively', async () => {
    const db = getTestDb();
    db.prepare(`UPDATE User SET email = 'Owner@TEST.com' WHERE id = 'owner-1'`).run();
    db.prepare(`UPDATE Inquiry SET userId = NULL, email = 'owner@test.com' WHERE id = 'inq-1'`).run();
    asUser({ id: 'owner-1', email: 'Owner@TEST.com' });
    const response = await declinePOST(
      declineRequest('inq-1', { reasonCode: 'plans_changed' }),
      { params: Promise.resolve({ id: 'inq-1' }) },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  it('rejects a personal inquiry when neither userId nor verified email matches', async () => {
    const db = getTestDb();
    db.prepare(`UPDATE Inquiry SET userId = NULL, email = 'stranger@example.com' WHERE id = 'inq-1'`).run();
    const response = await declinePOST(
      declineRequest('inq-1', { reasonCode: 'plans_changed' }),
      { params: Promise.resolve({ id: 'inq-1' }) },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: '无权操作此询价', code: 'FORBIDDEN' });
    const quote = db.prepare('SELECT status FROM Quote WHERE id = ?').get('q1') as { status: string };
    expect(quote.status).toBe('sent');
  });

  it('allows an organization member with orders.create and rejects a member without it', async () => {
    const db = getTestDb();
    db.prepare(`UPDATE Inquiry SET owner_scope = 'organization', organization_id = 'org-1', email = 'other@test.com' WHERE id = 'inq-1'`).run();
    requireOrganizationPermission.mockResolvedValue({ id: 'member-1' });
    const allowed = await declinePOST(declineRequest('inq-1', { reasonCode: 'other', note: '项目取消' }), { params: Promise.resolve({ id: 'inq-1' }) });
    expect(allowed.status).toBe(200);
    expect(requireOrganizationPermission).toHaveBeenCalledWith('owner-1', 'org-1', 'organization.orders.create');

    seedSentQuote('q-org-2', 'inq-pending');
    db.prepare(`UPDATE Inquiry SET status = 'quote_sent', owner_scope = 'organization', organization_id = 'org-1', email = 'other@test.com' WHERE id = 'inq-pending'`).run();
    requireOrganizationPermission.mockRejectedValue(new OrganizationRbacError('PERMISSION_DENIED', '组织权限不足'));
    const denied = await declinePOST(declineRequest('inq-pending', { reasonCode: 'plans_changed' }), { params: Promise.resolve({ id: 'inq-pending' }) });
    expect(denied.status).toBe(403);
    const quote = db.prepare('SELECT status FROM Quote WHERE id = ?').get('q-org-2') as { status: string };
    expect(quote.status).toBe('sent');
  });
});
