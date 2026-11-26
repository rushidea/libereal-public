import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/internal/harness/events/route';
import { sha256Hex } from '@/lib/harness-tools/auth';
import { prisma } from '@/lib/prisma';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

const environment = 'local-test';
const token = 'synthetic-event-token';
const since = '2026-11-26T10:00:00.000Z';
const supplierKind = 'inquiry.supplier_quote_reply_confirmed';
const feedbackKind = 'inquiry_feedback_received';

function configure(pilotInquiryIds?: string[]) {
  vi.stubEnv('LIBEREAL_HARNESS_TOOLS_CONFIG', JSON.stringify({
    enabled: true,
    environment,
    pilotInquiryIds,
    clients: [
      { clientId: 'reader', tokenSha256: sha256Hex(token), scopes: ['events.read'] },
      { clientId: 'other-reader', tokenSha256: sha256Hex(token), scopes: ['events.read'] },
      { clientId: 'inquiry-only', tokenSha256: sha256Hex(token), scopes: ['inquiry.read'] },
    ],
  }));
}

function poll(query: Record<string, string> | string, options: { clientId?: string; env?: string; token?: string } = {}) {
  const search = new URLSearchParams(query);
  return GET(new NextRequest(`http://localhost/api/internal/harness/events?${search}`, {
    headers: {
      'x-libereal-harness-client-id': options.clientId ?? 'reader',
      'x-libereal-harness-env': options.env ?? environment,
      'x-libereal-harness-token': options.token ?? token,
    },
  }));
}

function inquiry(id: string) {
  return prisma.inquiry.create({
    data: { id, name: 'Synthetic', email: 'customer@example.invalid', phone: '000', institution: 'Test' },
  });
}

function supplier(id: string, inquiryId: string, createdAt = since, action = supplierKind) {
  return prisma.auditLog.create({
    data: {
      id, action, resource: 'inquiries', targetType: 'Inquiry', targetId: inquiryId, createdAt,
      actorEmail: 'staff@example.invalid', afterData: 'supplier reply text', reason: 'internal reason',
    },
  });
}

function feedback(id: string, inquiryId: string, createdAt = since, metadata = JSON.stringify({ inquiryId })) {
  return prisma.notification.create({
    data: {
      id, role: 'admin', email: 'admin', type: feedbackKind, createdAt,
      title: 'internal notification', content: 'customer feedback text', metadata,
    },
  });
}

describe('Harness website event feed', () => {
  beforeAll(() => { getTestDb(); });
  beforeEach(() => {
    clearAllTables(getTestDb());
    configure();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
    closeTestDb();
  });

  it('requires machine identity, matching environment and the dedicated scope', async () => {
    expect((await GET(new NextRequest('http://localhost/api/internal/harness/events'))).status).toBe(401);
    expect((await poll({ since }, { token: 'incorrect' })).status).toBe(401);
    expect((await poll({ since }, { env: 'staging' })).status).toBe(403);
    expect((await poll({ since }, { clientId: 'inquiry-only' })).status).toBe(403);
    vi.stubEnv('LIBEREAL_HARNESS_TOOLS_CONFIG', '{}');
    expect((await poll({ since })).status).toBe(503);
  });

  it('requires one valid explicit starting point and enforces limit and cursor scope', async () => {
    const invalidQueries: Array<Record<string, string> | string> = [
      {}, { since, cursor: 'bad' }, { cursor: '' }, { cursor: 'not-a-cursor' },
      { since: '2026-02-30T11:00:00.000Z' }, { since: '2026-11-26T11:00:00+01:00' },
      { since, limit: '101' }, { since, limit: '0' },
      `since=${since}&since=${since}`, `since=${since}&inquiryId=other`,
    ];
    for (const query of invalidQueries) {
      expect((await poll(query)).status).toBe(400);
    }
    const response = await poll({ since, limit: '100' });
    expect(response.status).toBe(200);
    const { data: { nextCursor } } = await response.json();
    expect((await poll({ cursor: nextCursor }, { clientId: 'other-reader' })).status).toBe(400);
    configure(['explicitly-piloted']);
    expect((await poll({ cursor: nextCursor })).status).toBe(400);
  });

  it('returns only the two persisted event kinds and only approved inquiry IDs', async () => {
    await inquiry('pilot');
    await inquiry('outside-pilot');
    configure(['pilot']);
    await supplier('before-since', 'pilot', '2026-11-26T09:59:59.999Z');
    await supplier('a1', 'pilot');
    await supplier('out-of-scope-audit', 'outside-pilot');
    await supplier('other-audit-action', 'pilot', since, 'inquiry.supplier_quote_prepared');
    await feedback('f1', 'pilot', '2026-11-26T10:00:00.001Z');
    await feedback('malformed-metadata', 'pilot', since, 'invalid-json');
    await feedback('out-of-scope-notification', 'outside-pilot');
    await feedback('nonexistent-inquiry', 'nonexistent');
    await prisma.notification.update({ where: { id: 'f1' }, data: { deletedAt: new Date(since) } });

    const response = await poll({ since });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await response.json()).data).toEqual({
      events: [
        { id: 'audit:a1', kind: supplierKind, occurredAt: since, inquiryId: 'pilot' },
        { id: 'notification:f1', kind: feedbackKind, occurredAt: '2026-11-26T10:00:00.001Z', inquiryId: 'pilot' },
      ],
      nextCursor: expect.any(String),
    });
    expect(await prisma.auditLog.count()).toBe(4);
    expect(await prisma.notification.count()).toBe(4);
  });

  it('does not lose same-time events across pages or through an empty poll', async () => {
    await inquiry('pilot');
    const { data: initial } = await (await poll({ since, limit: '1' })).json();
    expect(initial.events).toEqual([]);
    expect(initial.nextCursor).toEqual(expect.any(String));

    await supplier('z-audit', 'pilot', '2026-11-26T10:00:01.000Z');
    await feedback('z-feedback', 'pilot', '2026-11-26T10:00:01.000Z');
    await supplier('a-audit', 'pilot', '2026-11-26T10:00:01.000Z');

    let cursor: string = initial.nextCursor;
    for (const id of ['audit:z-audit', 'audit:a-audit', 'notification:z-feedback']) {
      const { data: page } = await (await poll({ cursor, limit: '1' })).json();
      expect(page.events).toEqual([expect.objectContaining({ id })]);
      cursor = page.nextCursor;
    }
    const { data: idle } = await (await poll({ cursor })).json();
    expect(idle).toEqual({ events: [], nextCursor: cursor });

    await feedback('a-feedback', 'pilot', since);
    const { data: late } = await (await poll({ cursor: idle.nextCursor })).json();
    expect(late.events).toEqual([{ id: 'notification:a-feedback', kind: feedbackKind, occurredAt: since, inquiryId: 'pilot' }]);
    expect(late.nextCursor).not.toBe(cursor);
  });

  it('reports a stale anchor instead of silently continuing after rowid reuse', async () => {
    await inquiry('pilot');
    await supplier('prior', 'pilot');
    const { data: { nextCursor } } = await (await poll({ since })).json();
    await prisma.auditLog.delete({ where: { id: 'prior' } });
    await supplier('replacement', 'pilot');
    const result = await poll({ cursor: nextCursor });
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: 'EVENT_CURSOR_STALE', retryable: false });
  });

  it('does not confirm the existence of a forged anchor outside the allowed inquiry scope', async () => {
    configure(['pilot']);
    await inquiry('pilot');
    await inquiry('outside');
    await supplier('foreign-event', 'outside');
    const [foreign] = await prisma.$queryRaw<Array<{ rowId: string }>>`
      SELECT CAST(rowid AS TEXT) AS rowId FROM AuditLog WHERE id = 'foreign-event'
    `;
    const { data: { nextCursor } } = await (await poll({ since })).json();
    const decoded = JSON.parse(Buffer.from(nextCursor, 'base64url').toString('utf8'));
    for (const id of ['foreign-event', 'missing-event']) {
      const cursor = Buffer.from(JSON.stringify({ ...decoded, audit: { rowId: foreign.rowId, id } })).toString('base64url');
      const response = await poll({ cursor });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'EVENT_CURSOR_STALE' });
    }
  });
});
