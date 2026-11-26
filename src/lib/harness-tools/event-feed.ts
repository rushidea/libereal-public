import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sha256Hex, type HarnessPrincipal } from './auth';

const SUPPLIER_REPLY = 'inquiry.supplier_quote_reply_confirmed';
const CUSTOMER_FEEDBACK = 'inquiry_feedback_received';
type EventSource = 'audit' | 'notification';
type EventAnchor = { rowId: string; id: string };
type EventRow = EventAnchor & { inquiryId: string; occurredMs: string };
type EventCursor = {
  version: 1;
  scope: string;
  sinceMs: number;
  audit: EventAnchor | null;
  notification: EventAnchor | null;
};

function isEventAnchor(value: unknown): value is EventAnchor | null {
  if (value === null) return true;
  if (typeof value !== 'object' || !value) return false;
  const row = value as Partial<EventAnchor>;
  return typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 160
    && typeof row.rowId === 'string' && /^[1-9]\d{0,18}$/.test(row.rowId)
    && BigInt(row.rowId) <= BigInt('9223372036854775807');
}

function decodeCursor(encoded: string, scope: string): EventCursor | null {
  if (!/^[A-Za-z0-9_-]{1,1024}$/.test(encoded)) return null;
  try {
    const decoded = Buffer.from(encoded, 'base64url');
    if (decoded.toString('base64url') !== encoded) return null;
    const cursor = JSON.parse(decoded.toString('utf8')) as Partial<EventCursor> | null;
    if (!cursor || cursor.version !== 1 || cursor.scope !== scope
      || typeof cursor.sinceMs !== 'number' || !Number.isSafeInteger(cursor.sinceMs)
      || Math.abs(cursor.sinceMs) > 8_640_000_000_000_000
      || !isEventAnchor(cursor.audit) || !isEventAnchor(cursor.notification)) return null;
    return {
      version: 1, scope, sinceMs: cursor.sinceMs,
      audit: cursor.audit, notification: cursor.notification,
    };
  } catch {
    return null;
  }
}

export function parseEventFeedQuery(
  params: URLSearchParams,
  principal: HarnessPrincipal,
  pilotInquiryIds?: string[],
) {
  const allowedKeys = new Set(['cursor', 'since', 'limit']);
  for (const key of params.keys()) {
    if (!allowedKeys.delete(key)) return null;
  }
  const limit = params.get('limit') ?? '50';
  if (!/^(?:[1-9]\d?|100)$/.test(limit)) return null;
  const encoded = params.get('cursor');
  const since = params.get('since');
  if ((encoded === null) === (since === null)) return null;

  const pilot = pilotInquiryIds === undefined ? null : [...new Set(pilotInquiryIds)].sort();
  const scope = sha256Hex(JSON.stringify([principal.environment, principal.clientId, pilot]));
  if (encoded !== null) {
    const cursor = decodeCursor(encoded, scope);
    return cursor && { cursor, limit: Number(limit), pilot };
  }

  if (!since || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(since)) return null;
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs)) return null;
  const [seconds, fraction = ''] = since.slice(0, -1).split('.');
  if (new Date(sinceMs).toISOString() !== `${seconds}.${fraction.padEnd(3, '0')}Z`) return null;
  const cursor: EventCursor = { version: 1, scope, sinceMs, audit: null, notification: null };
  return { cursor, limit: Number(limit), pilot };
}

// Prisma's SQLite adapter and historical rows can store date-time values in
// ISO text or Unix milliseconds. Normalize both before comparing the boundary.
const OCCURRED_MS = Prisma.sql`CASE WHEN typeof(event.createdAt) = 'integer' THEN event.createdAt
  ELSE CAST(ROUND((julianday(event.createdAt) - 2440587.5) * 86400000) AS INTEGER) END`;

const INQUIRY_FROM_NOTIFICATION = Prisma.sql`CASE WHEN json_valid(event.metadata)
  THEN json_extract(event.metadata, '$.inquiryId') END`;

function pilotFilter(pilot: string[] | null) {
  return pilot === null ? Prisma.empty
    : Prisma.sql`AND inquiry.id IN (SELECT value FROM json_each(${JSON.stringify(pilot)}))`;
}

export async function readEventFeed(
  { cursor, limit, pilot }: NonNullable<ReturnType<typeof parseEventFeedQuery>>,
) {
  // Read both sources and validate their anchors against the same SQLite snapshot.
  return prisma.$transaction(async (tx) => {
    const [integrity] = await tx.$queryRaw<Array<{ audit: boolean; notification: boolean }>>`
      SELECT
        (${cursor.audit === null} OR EXISTS (
          SELECT 1 FROM AuditLog AS event JOIN Inquiry AS inquiry ON inquiry.id = event.targetId
          WHERE event.rowid = CAST(${cursor.audit?.rowId ?? '0'} AS INTEGER)
            AND event.id = ${cursor.audit?.id ?? ''}
            AND event.action = ${SUPPLIER_REPLY} AND event.resource = 'inquiries' AND event.targetType = 'Inquiry'
            AND (${OCCURRED_MS}) >= ${cursor.sinceMs} ${pilotFilter(pilot)}
        )) AS audit,
        (${cursor.notification === null} OR EXISTS (
          SELECT 1 FROM Notification AS event JOIN Inquiry AS inquiry ON inquiry.id = (${INQUIRY_FROM_NOTIFICATION})
          WHERE event.rowid = CAST(${cursor.notification?.rowId ?? '0'} AS INTEGER)
            AND event.id = ${cursor.notification?.id ?? ''}
            AND event.type = ${CUSTOMER_FEEDBACK} AND event.role = 'admin' AND event.email = 'admin'
            AND (${OCCURRED_MS}) >= ${cursor.sinceMs} ${pilotFilter(pilot)}
        )) AS notification
    `;
    if (!integrity.audit || !integrity.notification) return null;

    const audit = await tx.$queryRaw<EventRow[]>`
      SELECT CAST(event.rowid AS TEXT) AS rowId, event.id, inquiry.id AS inquiryId,
        CAST((${OCCURRED_MS}) AS TEXT) AS occurredMs
      FROM AuditLog AS event JOIN Inquiry AS inquiry ON inquiry.id = event.targetId
      WHERE event.rowid > CAST(${cursor.audit?.rowId ?? '0'} AS INTEGER)
        AND event.action = ${SUPPLIER_REPLY} AND event.resource = 'inquiries' AND event.targetType = 'Inquiry'
        AND (${OCCURRED_MS}) >= ${cursor.sinceMs} ${pilotFilter(pilot)}
      ORDER BY event.rowid LIMIT ${limit}
    `;
    const notification = await tx.$queryRaw<EventRow[]>`
      SELECT CAST(event.rowid AS TEXT) AS rowId, event.id, inquiry.id AS inquiryId,
        CAST((${OCCURRED_MS}) AS TEXT) AS occurredMs
      FROM Notification AS event JOIN Inquiry AS inquiry ON inquiry.id = (${INQUIRY_FROM_NOTIFICATION})
      WHERE event.rowid > CAST(${cursor.notification?.rowId ?? '0'} AS INTEGER)
        AND event.type = ${CUSTOMER_FEEDBACK} AND event.role = 'admin' AND event.email = 'admin'
        AND (${OCCURRED_MS}) >= ${cursor.sinceMs} ${pilotFilter(pilot)}
      ORDER BY event.rowid LIMIT ${limit}
    `;

    const events = [];
    const nextCursor = { ...cursor };
    // Preserve each source's commit order even when two events share a
    // timestamp or a later insert has an older eligible timestamp.
    const position = { audit: 0, notification: 0 };
    while (events.length < limit) {
      const supplier = audit[position.audit];
      const feedback = notification[position.notification];
      if (!supplier && !feedback) break;
      const source: EventSource = supplier &&
        (!feedback || Number(supplier.occurredMs) <= Number(feedback.occurredMs)) ? 'audit' : 'notification';
      const row = (source === 'audit' ? audit : notification)[position[source]++];
      nextCursor[source] = { rowId: row.rowId, id: row.id };
      events.push({
        id: `${source}:${row.id}`,
        kind: source === 'audit' ? SUPPLIER_REPLY : CUSTOMER_FEEDBACK,
        occurredAt: new Date(Number(row.occurredMs)).toISOString(),
        inquiryId: row.inquiryId,
      });
    }

    return {
      events,
      nextCursor: Buffer.from(JSON.stringify(nextCursor), 'utf8').toString('base64url'),
    };
  });
}
