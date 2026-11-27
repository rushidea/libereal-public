import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { letterHash } from '@/lib/business-letter-render';
import { loadSupplierQuoteScope } from '@/lib/supplier-quote-review';
import {
  fetchMailHeaderPage, isMailHash, isPositiveMailId, mailRecord, normalizeMailAddress,
  readMailRecord, supplierMailHeaderSource, type MailHeader, type SupplierMailHeaderSource,
} from '@/lib/supplier-mail-header-source';

// The pinned rollback release excludes this private prefix from its generic task
// API. Keep raw headers and the cursor hidden even if only the app is rolled back.
// These are receipts, never AI Ops jobs; only the new task API projects the view.
export const SUPPLIER_MAIL_HEADER_TASK = 'aiops.control.private_supplier_mail_headers';
export const SUPPLIER_MAIL_HEADER_CURSOR = 'aiops.control.private_supplier_mail_header_cursor';
export const SUPPLIER_MAIL_HEADER_VIEW = 'inquiry.supplier_mail_headers';
const CONFLICT = 'duplicate_conflict';
const QUOTE_TASK = 'inquiry.supplier_written_quote';
const CHANGED_SCOPE = new Set([
  'SUPPLIER_QUOTE_INQUIRY_NOT_ACTIVE', 'SUPPLIER_QUOTE_ITEM_NOT_ACTIVE', 'SUPPLIER_QUOTE_QUANTITY_INVALID',
  'SUPPLIER_QUOTE_PRODUCT_REVIEW_REQUIRED', 'BRAND_NOT_ACTIVE', 'SUPPLIER_QUOTE_NOT_REQUIRED', 'BRAND_CATALOG_PRICE_REQUIRED',
]);
type Db = Prisma.TransactionClient;
type Link = { letterId: string; inquiryId: string; inquiryItemId: string; reviewId: string; requestHash: string; evidenceSha256: string };
type Association = { state: 'linked'; link: Link } | { state: 'manual_review'; reason: string };

async function matchOriginalLetter(db: Db, source: SupplierMailHeaderSource, header: MailHeader): Promise<Association> {
  const manual = (reason: string): Association => ({ state: 'manual_review', reason });
  if (!header.messageId || !header.inReplyTo || header.messageId === header.inReplyTo) return manual('missing_or_invalid_thread_headers');
  const pairs = source.verifiedOutbound.filter(proof => proof.messageId === header.inReplyTo);
  if (pairs.length !== 1) return manual(pairs.length ? 'ambiguous_parent' : 'no_verified_parent');
  const proof = pairs[0];
  if (source.verifiedOutbound.filter(pair => pair.letterId === proof.letterId || pair.providerReceiptId === proof.providerReceiptId).length !== 1) {
    return manual('ambiguous_parent');
  }
  const letters = await db.$queryRaw<Array<{ id: string; snapshot: string; approvalHash: string; deliveryKey: string; result: string }>>`
    SELECT id,snapshot,approvalHash,deliveryKey,result FROM BusinessLetterDraft
    WHERE status='accepted' AND approvedBy IS NOT NULL AND approvedAt IS NOT NULL
      AND json_extract(CASE WHEN json_valid(result) THEN result END,'$.providerMessageId')=${proof.providerReceiptId}
    LIMIT 2`;
  if (letters.length !== 1 || letters[0].id !== proof.letterId) return manual('outbound_receipt_not_verified');
  const letter = letters[0];
  const sent = readMailRecord(letter.result);
  const snapshot = readMailRecord(letter.snapshot);
  const message = mailRecord(snapshot.message);
  if (sent.ok !== true || sent.provider !== 'resend' || sent.skipped === true || sent.deliveryState !== 'accepted'
    || letterHash(snapshot) !== letter.approvalHash || letterHash(message) !== letter.deliveryKey) {
    return manual('outbound_receipt_not_verified');
  }
  if (!header.sender || !Array.isArray(message.to) || message.to.length !== 1
    || normalizeMailAddress(message.to[0]) !== header.sender || normalizeMailAddress(message.replyTo)?.toLowerCase() !== source.mailbox) {
    return manual('addresses_do_not_match');
  }
  const requested = mailRecord(snapshot.source);
  const scope = mailRecord(requested.scope);
  const { inquiryId, inquiryItemId, quantity } = scope;
  const { reviewId, requestHash, sourceHash } = requested;
  if (typeof inquiryId !== 'string' || typeof inquiryItemId !== 'string' || !isPositiveMailId(quantity)
    || typeof reviewId !== 'string' || !isMailHash(requestHash) || !isMailHash(sourceHash)) return manual('no_current_inquiry');
  const review = await db.backgroundTask.findUnique({ where: { id: reviewId } });
  const reviewPayload = readMailRecord(review?.payload ?? null);
  const reviewScope = mailRecord(reviewPayload.scope);
  if (review?.type !== QUOTE_TASK || review.status !== 'awaiting_human'
    || reviewPayload.sourceHash !== sourceHash || reviewPayload.requestHash !== requestHash
    || reviewScope.inquiryId !== inquiryId || reviewScope.inquiryItemId !== inquiryItemId || reviewScope.quantity !== quantity) {
    return manual('no_current_inquiry');
  }
  try {
    const current = await loadSupplierQuoteScope(db, inquiryId, inquiryItemId, quantity, true);
    const active = mailRecord(readMailRecord(current.item.metadata).supplierQuoteRequests);
    if (current.requestHash !== sourceHash || active[String(quantity)] !== reviewId) return manual('no_current_inquiry');
  } catch (error) {
    if (error instanceof Error && CHANGED_SCOPE.has(error.message)) return manual('no_current_inquiry');
    throw error; // Transient DB failures must not advance the cursor as "unmatched".
  }
  return { state: 'linked', link: { letterId: letter.id, inquiryId, inquiryItemId, reviewId, requestHash, evidenceSha256: proof.evidenceSha256 } };
}

async function writeTaskOnce(db: Db, type: string, dedupeKey: string, payload: string, now: string) {
  const status = type === SUPPLIER_MAIL_HEADER_CURSOR ? 'succeeded' : 'awaiting_human';
  return db.$executeRaw`INSERT INTO BackgroundTask (id,type,status,payload,priority,attempts,maxAttempts,runAt,dedupeKey,createdAt,updatedAt)
    VALUES (${letterHash(dedupeKey)},${type},${status},${payload},0,0,0,${now},${dedupeKey},${now},${now})
    ON CONFLICT(dedupeKey) DO NOTHING`;
}

async function saveHeader(db: Db, source: SupplierMailHeaderSource, header: MailHeader, now: string) {
  const identity = header.messageId ? ['message', source.mailbox, header.messageId] : ['row', source.sourceId, source.mailbox, header.emailId];
  const key = `supplier-mail-header:${letterHash(identity)}`;
  const fingerprint = letterHash([header.messageId, header.inReplyTo, header.sender]);
  const existing = await db.backgroundTask.findUnique({ where: { dedupeKey: key } });
  if (existing) {
    const payload = readMailRecord(existing.payload);
    if (existing.type !== SUPPLIER_MAIL_HEADER_TASK || payload.mailbox !== source.mailbox || !isMailHash(payload.fingerprint)) {
      throw new Error('收件头记录不一致，游标未前移');
    }
    if (payload.fingerprint === fingerprint) return 'duplicate';
    if (readMailRecord(existing.result).state !== CONFLICT) {
      await db.backgroundTask.update({ where: { id: existing.id }, data: { status: 'awaiting_human', completedAt: null,
        result: JSON.stringify({ state: CONFLICT }) } });
      await writeAuditLog({ action: 'inquiry.supplier_mail_header_conflict', resource: 'inquiries', targetType: 'BackgroundTask',
        targetId: existing.id, after: { sourceId: source.sourceId, emailId: header.emailId, fingerprint },
        reason: '同一邮件标识出现不同邮件头，保留原记录并暂停自动关联，交人工核对' }, db);
    }
    return 'conflict';
  }
  const association = await matchOriginalLetter(db, source, header);
  const data = { version: 1, sourceId: source.sourceId, mailbox: source.mailbox, fingerprint, header, association, senderAuthority: 'unverified' };
  if (await writeTaskOnce(db, SUPPLIER_MAIL_HEADER_TASK, key, JSON.stringify(data), now) !== 1) {
    throw new Error('收件记录正在被处理，游标未前移');
  }
  await writeAuditLog({ action: 'inquiry.supplier_mail_header_saved', resource: 'inquiries', targetType: 'BackgroundTask',
    targetId: letterHash(key), after: { sourceId: source.sourceId, fingerprint, association },
    reason: '保存收件头以便核对原询价；未确认供应商回复，也未生成报价' }, db);
  return 'inserted';
}

function fromCursor(task: { type: string; payload: string } | null, scopeHash: string, startAfter: number) {
  if (!task) return startAfter;
  const stored = readMailRecord(task.payload);
  if (task.type !== SUPPLIER_MAIL_HEADER_CURSOR || stored.scopeHash !== scopeHash || !isPositiveMailId(stored.after) || stored.after < startAfter) {
    throw new Error('收件头来源或起点已变，须核对原游标');
  }
  return stored.after;
}

/** One bounded page; no scheduler, no send, and no access to an administrator session. */
export async function syncSupplierMailHeadersOnce(source = supplierMailHeaderSource()) {
  const cursorKey = `supplier-mail-header-cursor:${letterHash([source.sourceId, source.mailbox])}`;
  const scopeHash = letterHash([source.origin, source.mailbox, source.startAfter]);
  const lookup = { dedupeKey: cursorKey };
  const start = await prisma.backgroundTask.findUnique({ where: lookup });
  const after = fromCursor(start, scopeHash, source.startAfter);
  const page = await fetchMailHeaderPage(source, after);
  const result = { nextAfter: page.nextAfter, blocked: page.blocked, hasMore: page.hasMore, inserted: 0, duplicates: 0, conflicts: 0 };
  if (!page.emails.length) return result;
  return prisma.$transaction(async db => {
    const now = new Date().toISOString();
    // This write acquires SQLite's writer lock before comparing the cursor again.
    await writeTaskOnce(db, SUPPLIER_MAIL_HEADER_CURSOR, cursorKey, JSON.stringify({ scopeHash, after }), now);
    const cursor = await db.backgroundTask.findUniqueOrThrow({ where: lookup });
    if (fromCursor(cursor, scopeHash, source.startAfter) !== after) throw new Error('收件头游标已前移，请从新游标读取');
    for (const header of page.emails) {
      const saved = await saveHeader(db, source, header, now);
      if (saved === 'inserted') result.inserted++;
      if (saved === 'duplicate') result.duplicates++;
      if (saved === 'conflict') result.conflicts++;
    }
    await db.backgroundTask.update({ where: { id: cursor.id }, data: { payload: JSON.stringify({ scopeHash, after: page.nextAfter }) } });
    return result;
  });
}

export function supplierMailReceiptLink(task: { type: string; payload: string; result: string | null }) {
  if (task.type !== SUPPLIER_MAIL_HEADER_TASK || supplierMailReceiptConflict(task)) return null;
  const association = mailRecord(readMailRecord(task.payload).association);
  const link = mailRecord(association.link);
  if (association.state !== 'linked' || typeof link.inquiryId !== 'string' || typeof link.reviewId !== 'string'
    || !isMailHash(link.requestHash)) return null;
  return { inquiryId: link.inquiryId, reviewId: link.reviewId, requestHash: link.requestHash };
}

export function supplierMailReceiptConflict(task: { result: string | null }) {
  return readMailRecord(task.result).state === CONFLICT;
}

export function supplierMailReceiptVersion(task: { id: string; status: string; payload: string; result: string | null }) {
  return letterHash([task.id, task.status, task.payload, task.result]);
}

export async function supplierMailHeadersForReview(inquiryId: string, reviewId: string, requestHash: string) {
  const limit = 10;
  const rows = await prisma.$queryRaw<Array<{ id: string; type: string; payload: string; result: string | null }>>`
    SELECT id,type,payload,result FROM BackgroundTask WHERE type=${SUPPLIER_MAIL_HEADER_TASK} AND status='awaiting_human'
      AND json_extract(CASE WHEN json_valid(payload) THEN payload END,'$.association.link.inquiryId')=${inquiryId}
      AND json_extract(CASE WHEN json_valid(payload) THEN payload END,'$.association.link.reviewId')=${reviewId}
      AND json_extract(CASE WHEN json_valid(payload) THEN payload END,'$.association.link.requestHash')=${requestHash}
      AND json_extract(CASE WHEN json_valid(result) THEN result END,'$.state') IS NOT ${CONFLICT}
    ORDER BY createdAt DESC,id DESC LIMIT ${limit + 1}`;
  const mailReceipts = rows.slice(0, limit).flatMap(row => {
    const link = supplierMailReceiptLink(row);
    const header = mailRecord(readMailRecord(row.payload).header);
    return link?.inquiryId === inquiryId && link.reviewId === reviewId && link.requestHash === requestHash
      && isPositiveMailId(header.emailId) && typeof header.sender === 'string'
      ? [{ receiptId: row.id, emailId: header.emailId, sender: header.sender }] : [];
  });
  return { mailReceipts, hasMoreMailReceipts: rows.length > limit };
}

/** Only a human may close this inbox task; neither the payload nor the dedupe key is removed. */
export async function acknowledgeSupplierMailHeader(taskId: string, version: string, actor: { id: string; email: string }) {
  return prisma.$transaction(async db => {
    const task = await db.backgroundTask.findUnique({ where: { id: taskId } });
    if (!task || task.type !== SUPPLIER_MAIL_HEADER_TASK || task.status !== 'awaiting_human' || supplierMailReceiptVersion(task) !== version) return false;
    // Compare the persisted review state directly. In particular, a re-opened task
    // has a different result even if its status resembles the earlier version.
    const changed = await db.backgroundTask.updateMany({ where: { id: taskId, type: SUPPLIER_MAIL_HEADER_TASK, status: task.status,
      payload: task.payload, result: task.result },
      data: { status: 'succeeded', completedAt: new Date() } });
    if (changed.count !== 1) return false;
    await writeAuditLog({ actorId: actor.id, actorEmail: actor.email, action: 'inquiry.supplier_mail_header_reviewed',
      resource: 'inquiries', targetType: 'BackgroundTask', targetId: taskId,
      reason: '人工结束收件头核对；保留邮件与防重记录，不确认供应商回复或报价' }, db);
    return true;
  });
}
