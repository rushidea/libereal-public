import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

const { requireAdmin } = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin' })),
}));
vi.mock('@/lib/session', () => ({ requireAdmin }));

import { GET, PATCH } from '@/app/api/admin/tasks/route';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { prisma } from '@/lib/prisma';
import { SUPPLIER_MAIL_HEADER_CURSOR, SUPPLIER_MAIL_HEADER_TASK, SUPPLIER_MAIL_HEADER_VIEW } from '@/lib/supplier-mail-headers';

describe('admin task routes', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    requireAdmin.mockClear();
  });

  it('lists tasks with status summaries', async () => {
    await enqueueBackgroundTask('email.send', { to: 'user@example.com' });
    const response = await GET(new NextRequest('http://localhost:3000/api/admin/tasks?status=pending'));
    expect(response.status).toBe(200);
    expect(requireAdmin).toHaveBeenCalledWith('tasks.read');
    const data = await response.json();
    expect(data.total).toBe(1);
    expect(data.counts.pending).toBe(1);
  });

  it('retries a failed task and writes an audit entry', async () => {
    const task = await enqueueBackgroundTask('search.index_update', {});
    await prisma.backgroundTask.update({ where: { id: task.id }, data: { status: 'failed', attempts: 3, lastError: 'send failed' } });
    const response = await PATCH(new NextRequest('http://localhost:3000/api/admin/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, action: 'retry' }),
    }));
    expect(response.status).toBe(200);
    expect(requireAdmin).toHaveBeenCalledWith('tasks.manage');
    expect(getTestDb().prepare('SELECT action, resource FROM AuditLog WHERE targetId = ?').get(task.id)).toEqual({ action: 'task.retried', resource: 'tasks' });
  });

  it('lists a human supplier wait without exposing reply amounts and refuses a generic retry', async () => {
    const task = await prisma.backgroundTask.create({ data: { type: 'inquiry.supplier_written_quote', status: 'awaiting_human',
      payload: JSON.stringify({ scope: { inquiryId: 'synthetic_inquiry' }, supplier: 'Private supplier' }),
      result: JSON.stringify({ reply: { supplierUnitPrice: 450 } }) } });
    const response = await GET(new NextRequest('http://localhost:3000/api/admin/tasks?status=awaiting_human'));
    expect(response.status).toBe(200); const data = await response.json();
    expect(data.counts.awaiting_human).toBe(1);
    expect(data.tasks[0]).toMatchObject({ id: task.id, status: 'awaiting_human', inquiryId: 'synthetic_inquiry', payload: null, result: null });
    await prisma.backgroundTask.update({ where: { id: task.id }, data: { status: 'failed' } });
    const retried = await PATCH(new NextRequest('http://localhost:3000/api/admin/tasks', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: task.id, action: 'retry' }),
    }));
    expect(retried.status).toBe(409);
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('failed');
  });

  it('shows only the reference for a mail review and excludes the private cursor from task reads and retries', async () => {
    const task = await prisma.backgroundTask.create({ data: {
      type: SUPPLIER_MAIL_HEADER_TASK, status: 'awaiting_human',
      payload: JSON.stringify({ header: { emailId: 101, sender: 'private@example.test', messageId: '<private@example.test>' },
        association: { state: 'linked', link: { inquiryId: 'inquiry_fixture', reviewId: 'review_fixture', requestHash: 'a'.repeat(64) } } }),
    } });
    const mailCursor = await prisma.backgroundTask.create({ data: {
      type: SUPPLIER_MAIL_HEADER_CURSOR, status: 'succeeded', payload: '{"after":101}',
    } });
    const listed = await GET(new NextRequest('http://localhost:3000/api/admin/tasks'));
    const value = await listed.json();
    expect(value.tasks).toHaveLength(1);
    expect(value.tasks[0]).toMatchObject({ id: task.id, type: SUPPLIER_MAIL_HEADER_VIEW, inquiryId: 'inquiry_fixture',
      mailEmailId: 101, payload: null, result: null });
    expect(value.tasks[0].mailReviewVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(value)).not.toContain('private@example.test');
    expect(value.types).not.toContain(mailCursor.type);
    expect(value.types).toEqual([SUPPLIER_MAIL_HEADER_VIEW]);
    const byType = await GET(new NextRequest(`http://localhost:3000/api/admin/tasks?type=${SUPPLIER_MAIL_HEADER_VIEW}`));
    expect((await byType.json()).total).toBe(1);
    // The pinned 0b60130 task list would return full payloads for non-AI types.
    // None of these rows may be visible under its existing database filter.
    expect(await prisma.backgroundTask.findMany({
      where: { type: { not: { startsWith: 'aiops.control.' } } },
    })).toEqual([]);
    for (const id of [task.id, mailCursor.id]) expect((await PATCH(new NextRequest('http://localhost:3000/api/admin/tasks', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'retry' }),
    }))).status).toBe(409);
    const acknowledge = (id: string, mailReviewVersion = value.tasks[0].mailReviewVersion) => new NextRequest('http://localhost:3000/api/admin/tasks', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action: 'acknowledge_supplier_mail', mailReviewVersion }),
    });
    requireAdmin.mockImplementationOnce(async () => ({ id: 'admin_test_id', email: 'admin@test.com', role: 'admin' }))
      .mockResolvedValueOnce(NextResponse.json({ error: 'restricted' }, { status: 403 }) as never);
    expect((await PATCH(acknowledge(task.id))).status).toBe(403);
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('awaiting_human');
    expect((await PATCH(acknowledge(task.id, '0'.repeat(64)))).status).toBe(409);
    expect((await PATCH(acknowledge(task.id))).status).toBe(200);
    expect((await PATCH(acknowledge(mailCursor.id))).status).toBe(409);
    expect(requireAdmin).toHaveBeenCalledWith('inquiries.write');
    expect(await prisma.quote.count()).toBe(0);
  });
  it('records the actual delivery review without re-sending and binds the evidence to the shown version', async () => {
    const task = await prisma.backgroundTask.create({ data: { type: 'sms.send', status: 'awaiting_human',
      payload: '{"phone":"private-number"}', lastError: 'legacy uncertain', attempts: 1 } });
    const get = async () => (await (await GET(new NextRequest('http://localhost/api/admin/tasks'))).json()).tasks[0];
    const patch = (data: unknown) => PATCH(new NextRequest('http://localhost/api/admin/tasks', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }));
    const original = await get();
    expect(JSON.stringify(original)).not.toContain('private-number');
    expect((await patch({ id: task.id, action: 'retry' })).status).toBe(409);
    const review = { id: task.id, action: 'record_delivery_review', version: original.deliveryVersion,
      outcome: 'partial', reference: 'local admin delivery log', sha256: 'a'.repeat(64) };
    expect((await patch(review)).status).toBe(200);
    expect((await patch(review)).status).toBe(200);
    const second = await get();
    expect(second.status).toBe('awaiting_human');
    expect(second.deliveryVersion).not.toBe(original.deliveryVersion);
    expect((await patch({ ...review, outcome: 'all_accepted' })).status).toBe(409);
    expect((await patch({ ...review, outcome: 'none_accepted', version: second.deliveryVersion, sha256: 'b'.repeat(64) })).status).toBe(200);
    expect((await get()).status).toBe('delivery_reviewed');
    expect(await prisma.auditLog.count({ where: { action: 'task.delivery_reviewed', targetId: task.id } })).toBe(2);
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: task.id } })).attempts).toBe(1);
  });

});
