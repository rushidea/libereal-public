import fs from 'node:fs';
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { letterHash } from '@/lib/business-letter-render';
import { prepareSupplierQuoteReview } from '@/lib/supplier-quote-review';
import { parseSupplierMailHeaderSource } from '@/lib/supplier-mail-header-source';
import {
  SUPPLIER_MAIL_HEADER_TASK, SUPPLIER_MAIL_HEADER_CURSOR, supplierMailHeadersForReview, syncSupplierMailHeadersOnce,
  acknowledgeSupplierMailHeader, supplierMailReceiptVersion,
} from '@/lib/supplier-mail-headers';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

const mailbox = 'orders@example.test';
const sender = 'supplier@example.test';
const originalMessageId = 'actual-delivered-id@example.test';
const pair = { letterId: 'letter_fixture', providerReceiptId: 'provider_receipt_1', messageId: originalMessageId, evidenceSha256: 'c'.repeat(64) };
const source = parseSupplierMailHeaderSource({
  sourceId: 'example-cloud-mail', origin: 'https://mail.example.test', mailbox, startAfter: 100,
  key: '12'.repeat(32), verifiedOutbound: [pair],
});
const header = (emailId = 101, changes = {}) => ({
  emailId, sendEmail: sender, messageId: '<actual-reply-id@example.test>', inReplyTo: `<${originalMessageId}>`, ...changes,
});
type RawHeader = ReturnType<typeof header>;
const page = (emails: RawHeader[], nextAfter = emails.at(-1)?.emailId ?? 100, blocked = false) => ({
  version: 1, mailbox, nextAfter, blocked, hasMore: false, emails,
});
const replyPage = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const stubPage = (value: unknown) => {
  const fetcher = vi.fn<(url: URL, init: RequestInit) => Promise<Response>>(async () => replyPage(value));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
};
const receipts = () => prisma.backgroundTask.findMany({ where: { type: SUPPLIER_MAIL_HEADER_TASK }, orderBy: { createdAt: 'asc' } });
const cursor = () => prisma.backgroundTask.findFirst({ where: { type: SUPPLIER_MAIL_HEADER_CURSOR } });
const audits = () => prisma.auditLog.count({ where: { action: { startsWith: 'inquiry.supplier_mail_header_' } } });
const registration = () => ({ provider: 'resend', ok: true, deliveryState: 'accepted', providerMessageId: pair.providerReceiptId });

async function seedApprovedLetter() {
  await prisma.user.create({ data: { id: 'customer_fixture', name: 'Example customer', email: 'customer@example.test' } });
  await prisma.brand.create({ data: { id: 'brand_fixture', name: 'Example Brand', defaultDiscountRate: 0.8, supplierQuoteRequiredAbove: 500 } });
  await prisma.product.create({ data: { id: 'product_fixture', brand: 'Example Brand', brandRecordId: 'brand_fixture',
    catalogNumber: 'EX-1', name: 'Example product', price: 640, originalPrice: 800 } });
  await prisma.inquiry.create({ data: { id: 'inquiry_fixture', name: 'Example customer', email: 'customer@example.test',
    userId: 'customer_fixture', phone: 'test', institution: 'test', inquiryItems: { create: {
      id: 'line_fixture', position: 0, quantity: 2, name: 'Example product', productId: 'product_fixture', catalogNumber: 'EX-1',
    } } } });
  const current = await prisma.$transaction(tx => prepareSupplierQuoteReview(tx, { inquiryId: 'inquiry_fixture',
    inquiryItemId: 'line_fixture', actor: { id: 'fixture-staff', email: 'staff@example.test' } }));
  const task = await prisma.backgroundTask.findUniqueOrThrow({ where: { id: current.reviewId } });
  // This is a stored mail-provider receipt fixture, not a login or an actual send.
  const message = { to: [sender], replyTo: mailbox, subject: 'not collected', text: 'NOT EXPORTED', html: '<p>NOT EXPORTED</p>' };
  const snapshot = { message, source: { reviewId: current.reviewId, requestHash: current.requestHash,
    sourceHash: JSON.parse(task.payload).sourceHash, scope: current.scope } };
  const now = new Date().toISOString();
  const db = getTestDb();
  db.prepare('INSERT INTO BusinessLetterTemplate (id,name,subject,body,updatedAt) VALUES (?,?,?,?,?)')
    .run('template_fixture', 'Fixture', 'Example', 'Example', now);
  db.prepare(`INSERT INTO BusinessLetterDraft
    (id,templateId,templateRevision,businessReference,snapshot,approvalHash,deliveryKey,status,origin,createdBy,approvedBy,approvedAt,result,createdAt,updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(pair.letterId, 'template_fixture', 1, 'inquiry_fixture', JSON.stringify(snapshot),
      letterHash(snapshot), letterHash(message), 'accepted', 'manual', 'fixture-staff', 'fixture-staff', now, JSON.stringify(registration()), now, now);
  return current;
}

describe('supplier mail header batch into the original review', () => {
  beforeAll(() => {
    const db = getTestDb();
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='BusinessLetterDraft'").get()) {
      db.exec(fs.readFileSync('prisma/migrations/20261117010000_business_letter_templates/migration.sql', 'utf8'));
    }
  });
  beforeEach(() => {
    clearAllTables(getTestDb());
    getTestDb().exec('DELETE FROM BusinessLetterDraft; DELETE FROM BusinessLetterTemplate;');
    vi.stubEnv('SUPPLIER_MAIL_HEADERS_ENABLED', '');
    vi.stubEnv('SUPPLIER_MAIL_INTAKE_ENABLED', '');
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  afterAll(async () => { await prisma.$disconnect(); closeTestDb(); });

  it('is disabled by default and never reaches a mailbox without configuration', async () => {
    const fetcher = stubPage(page([]));
    await expect(syncSupplierMailHeadersOnce()).rejects.toThrow('尚未启用');
    expect(fetcher).not.toHaveBeenCalled();
    expect(await cursor()).toBeNull();
  });

  it('uses the verified delivered header, saves repeat deliveries once, and leaves the original quote pending human review', async () => {
    const review = await seedApprovedLetter();
    const before = await prisma.inquiry.findUnique({ where: { id: 'inquiry_fixture' }, include: { inquiryItems: true } });
    const fetcher = stubPage(page([header(), header(102, { messageId: 'actual-reply-id@example.test', sendEmail: 'supplier@EXAMPLE.test' })], 102, true));
    expect(await syncSupplierMailHeadersOnce(source)).toEqual({ inserted: 1, duplicates: 1, conflicts: 0, nextAfter: 102, blocked: true, hasMore: false });
    const [url, init] = fetcher.mock.calls[0];
    expect(url.href).toBe('https://mail.example.test/api/integrations/inbox-headers?after=100&limit=25');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    const headers = new Headers(init.headers);
    const signature = createHmac('sha256', Buffer.from(source.key, 'hex'))
      .update(`cloud-mail-inbox-headers-v1\nGET\n${url.pathname}${url.search}\n${headers.get('x-inbox-timestamp')}`).digest('hex');
    expect(headers.get('x-inbox-signature')).toBe(signature);
    expect(headers.has('authorization')).toBe(false);
    const rows = await receipts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'awaiting_human', maxAttempts: 0 });
    expect(rows[0].payload).not.toContain('NOT EXPORTED');
    expect(JSON.parse(rows[0].payload)).toMatchObject({ senderAuthority: 'unverified', association: { state: 'linked', link: {
      inquiryId: 'inquiry_fixture', reviewId: review.reviewId, requestHash: review.requestHash, evidenceSha256: pair.evidenceSha256,
    } } });
    expect(await supplierMailHeadersForReview('inquiry_fixture', review.reviewId, review.requestHash)).toEqual({
      mailReceipts: [{ receiptId: rows[0].id, emailId: 101, sender }], hasMoreMailReceipts: false,
    });
    expect((await supplierMailHeadersForReview('inquiry_unrelated', review.reviewId, review.requestHash)).mailReceipts).toEqual([]);
    expect(await prisma.inquiry.findUnique({ where: { id: 'inquiry_fixture' }, include: { inquiryItems: true } })).toEqual(before);
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: review.reviewId } })).status).toBe('awaiting_human');
    expect(await prisma.quote.count()).toBe(0);
    expect(await prisma.order.count()).toBe(0);
    expect(await audits()).toBe(1);
  });

  it.each([
    ['no_verified_parent', [], { inReplyTo: '<provider_receipt_1@example.test>' }],
    ['ambiguous_parent', [pair, { ...pair, letterId: 'another_letter', providerReceiptId: 'another_receipt' }], {}],
    ['ambiguous_parent', [pair, { ...pair, messageId: 'another@example.test' }], {}],
    ['outbound_receipt_not_verified', [{ ...pair, providerReceiptId: 'wrong_receipt' }], {}],
    ['addresses_do_not_match', [pair], { sendEmail: 'other@example.test' }],
    ['missing_or_invalid_thread_headers', [pair], { inReplyTo: '<first@example.test> <second@example.test>' }],
    ['missing_or_invalid_thread_headers', [pair], { messageId: null }],
  ])('leaves %s for human review rather than guessing a link', async (reason, verifiedOutbound, fields) => {
    const review = await seedApprovedLetter();
    stubPage(page([header(101, fields)]));
    await syncSupplierMailHeadersOnce({ ...source, verifiedOutbound });
    expect(JSON.parse((await receipts())[0].payload).association).toEqual({ state: 'manual_review', reason });
    expect((await supplierMailHeadersForReview('inquiry_fixture', review.reviewId, review.requestHash)).mailReceipts).toEqual([]);
    expect(await prisma.quote.count()).toBe(0);
  });

  it('does not attach to a review whose pricing source has changed', async () => {
    await seedApprovedLetter();
    await prisma.product.update({ where: { id: 'product_fixture' }, data: { originalPrice: 850 } });
    stubPage(page([header()]));
    await syncSupplierMailHeadersOnce(source);
    expect(JSON.parse((await receipts())[0].payload).association).toEqual({ state: 'manual_review', reason: 'no_current_inquiry' });
  });

  it('preserves the original receipt and quarantines a conflicting repeat, once', async () => {
    const review = await seedApprovedLetter();
    stubPage(page([header()]));
    await syncSupplierMailHeadersOnce(source);
    const [first] = await receipts();
    const amended = header(102, { inReplyTo: '<different@example.test>' });
    stubPage(page([amended, { ...amended, emailId: 103 }]));
    expect(await syncSupplierMailHeadersOnce(source)).toMatchObject({ inserted: 0, conflicts: 2, nextAfter: 103 });
    const rows = await receipts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, payload: first.payload, status: 'awaiting_human', result: '{"state":"duplicate_conflict"}' });
    expect((await supplierMailHeadersForReview('inquiry_fixture', review.reviewId, review.requestHash)).mailReceipts).toEqual([]);
    expect(await audits()).toBe(2);
  });

  it('refuses extra body fields, foreign mailboxes and cursors beyond the returned page', async () => {
    for (const value of [page([header(101, { text: 'Do not collect' })]), { ...page([header()]), mailbox: 'other@example.test' }, page([header()], 999)]) {
      stubPage(value);
      await expect(syncSupplierMailHeadersOnce(source)).rejects.toThrow();
      expect(await cursor()).toBeNull();
      expect(await receipts()).toHaveLength(0);
    }
  });

  it('rolls back the receipt and cursor together if saving the audit fails', async () => {
    const db = getTestDb();
    db.exec(`CREATE TRIGGER b1a_mail_fixture_abort BEFORE INSERT ON AuditLog
      WHEN NEW.action = 'inquiry.supplier_mail_header_saved' BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END`);
    try {
      stubPage(page([header()]));
      await expect(syncSupplierMailHeadersOnce(source)).rejects.toThrow();
      expect(await receipts()).toHaveLength(0);
      expect(await cursor()).toBeNull();
    } finally { db.exec('DROP TRIGGER b1a_mail_fixture_abort'); }
    stubPage(page([header()]));
    expect(await syncSupplierMailHeadersOnce(source)).toMatchObject({ inserted: 1, nextAfter: 101 });
  });

  it('will not commit an earlier page fetched before another process advanced the cursor', async () => {
    let deliver!: (response: Response) => void;
    let requested!: () => void;
    const started = new Promise<void>(resolve => { requested = resolve; });
    const delayed = new Promise<Response>(resolve => { deliver = resolve; });
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => { requested(); return delayed; }).mockImplementation(async () =>
      replyPage(page([header()]))));
    const first = syncSupplierMailHeadersOnce(source).catch(error => error);
    await started;
    await syncSupplierMailHeadersOnce(source);
    deliver(replyPage(page([header()])));
    expect((await first).message).toContain('游标已前移');
    expect(await receipts()).toHaveLength(1);
    expect(await audits()).toBe(1);
  });

  it('applies the limit after excluding other review versions, completed records and conflicts', async () => {
    const reviewId = 'current_review';
    const requestHash = 'd'.repeat(64);
    const task = (emailId: number, scopeId: string, state = 'awaiting_human', result: string | null = null) => ({
      type: SUPPLIER_MAIL_HEADER_TASK, status: state, result, createdAt: new Date(2027, 0, 1, 0, 0, emailId),
      payload: JSON.stringify({ header: { emailId, sender }, association: {
        state: 'linked', link: { inquiryId: 'inquiry_fixture', reviewId: scopeId, requestHash },
      } }),
    });
    await prisma.backgroundTask.createMany({ data: [
      ...Array.from({ length: 12 }, (_, index) => task(100 + index, reviewId)),
      ...Array.from({ length: 32 }, (_, index) => task(200 + index, 'previous_review')),
      task(300, reviewId, 'awaiting_human', '{"state":"duplicate_conflict"}'),
      task(301, reviewId, 'succeeded'),
    ] });
    const visible = await supplierMailHeadersForReview('inquiry_fixture', reviewId, requestHash);
    expect(visible.hasMoreMailReceipts).toBe(true);
    expect(visible.mailReceipts.map(row => row.emailId)).toEqual([111, 110, 109, 108, 107, 106, 105, 104, 103, 102]);
  });

  it('closing a manual wait is audited once and leaves the durable receipt and dedupe key on record', async () => {
    const review = await seedApprovedLetter();
    stubPage(page([header()]));
    await syncSupplierMailHeadersOnce(source);
    const [first] = await receipts();
    const operator = { id: 'reviewer_fixture', email: 'reviewer@example.test' };
    const shownVersion = supplierMailReceiptVersion(first);
    expect(await acknowledgeSupplierMailHeader(first.id, shownVersion, operator)).toBe(true);
    expect(await acknowledgeSupplierMailHeader(first.id, shownVersion, operator)).toBe(false);
    expect(await acknowledgeSupplierMailHeader(review.reviewId, shownVersion, operator)).toBe(false);
    stubPage(page([header(102)]));
    expect(await syncSupplierMailHeadersOnce(source)).toMatchObject({ inserted: 0, duplicates: 1 });
    expect(await receipts()).toMatchObject([{ id: first.id, status: 'succeeded', payload: first.payload, dedupeKey: first.dedupeKey }]);
    expect(await audits()).toBe(2);
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: review.reviewId } })).status).toBe('awaiting_human');
    expect(await prisma.quote.count()).toBe(0);
  });

  it('rejects a delayed close when a conflict has changed the task', async () => {
    const review = await seedApprovedLetter();
    stubPage(page([header()]));
    await syncSupplierMailHeadersOnce(source);
    const [first] = await receipts();
    const beforeConflict = supplierMailReceiptVersion(first);
    const operator = { id: 'reviewer_fixture', email: 'reviewer@example.test' };
    expect(await acknowledgeSupplierMailHeader(first.id, beforeConflict, operator)).toBe(true);
    stubPage(page([header(102, { inReplyTo: '<another@example.test>' })]));
    await syncSupplierMailHeadersOnce(source);
    const [reopened] = await receipts();
    expect(reopened).toMatchObject({ id: first.id, status: 'awaiting_human', result: '{"state":"duplicate_conflict"}' });
    expect(await acknowledgeSupplierMailHeader(first.id, beforeConflict, operator)).toBe(false);
    expect((await receipts())[0].status).toBe('awaiting_human');
    expect((await supplierMailHeadersForReview('inquiry_fixture', review.reviewId, review.requestHash)).mailReceipts).toEqual([]);
    expect(await acknowledgeSupplierMailHeader(first.id, supplierMailReceiptVersion(reopened), operator)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'inquiry.supplier_mail_header_reviewed' } })).toBe(2);
  });
});
