import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/mail', () => ({ sendBusinessMailNow: vi.fn(), businessMailAvailable: vi.fn(() => true) }));
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sendBusinessMailNow } from '@/lib/mail';
import { saveLetterTemplate, prepareBusinessLetter, approveBusinessLetter, dispatchApprovedBusinessLetter, getLetterDraft } from '@/lib/business-letters';
import { renderBusinessLetter, validateTemplate } from '@/lib/business-letter-render';
import { LETTER_STARTERS } from '@/lib/business-letter-content';
import { prepareSupplierQuoteReview } from '@/lib/supplier-quote-review';
import { POST as templateRoute } from '@/app/api/admin/business-letter-templates/route';
import { POST as letterRoute } from '@/app/api/admin/business-letters/route';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

const actor = { id: 'admin_test_id', email: 'admin@test.com' };
const config = { from: 'order@example.test', replyTo: 'order@example.test', siteUrl: 'https://example.test' };
const input = { to: 'supplier@example.test', businessReference: 'INQ-EXAMPLE', fields: {
  salutation: '业务负责人：', products: 'Example Product\nEX-1 × 2', details: '请确认供货信息。', signature: 'Example Company',
} };
function request(body: unknown) { return new NextRequest('http://localhost/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
async function makeDraft() {
  const template = await saveLetterTemplate({ ...LETTER_STARTERS[0], enabled: true }, actor);
  const draft = await prepareBusinessLetter({ ...input, templateId: template.id, templateRevision: template.revision }, actor);
  return { template, draft };
}

describe('shared business letter templates and durable sending', () => {
  beforeAll(() => {
    const db = getTestDb();
    db.exec('DROP TABLE IF EXISTS BusinessLetterDraft; DROP TABLE IF EXISTS BusinessLetterTemplate;');
    db.exec(readFileSync('prisma/migrations/20261117010000_business_letter_templates/migration.sql', 'utf8'));
  });
  beforeEach(() => {
    const db = getTestDb(); db.exec('DELETE FROM BusinessLetterDraft; DELETE FROM BusinessLetterTemplate;');
    clearAllTables(db); seedAdmin(db); vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { ...actor, role: 'admin', sessionId: 'business-letter-session' } } as never);
    vi.mocked(sendBusinessMailNow).mockResolvedValue({ ok: true, provider: 'resend', deliveryState: 'accepted', providerMessageId: 'example-provider-id' });
    vi.stubEnv('BUSINESS_MAIL_FROM', config.from); vi.stubEnv('BUSINESS_MAIL_REPLY_TO', config.replyTo);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', config.siteUrl); vi.stubEnv('BUSINESS_MAIL_ENABLED', 'true'); vi.stubEnv('BUSINESS_MAIL_RESEND_API_KEY', 'synthetic-key');
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => { await prisma.$disconnect(); closeTestDb(); });

  it('escapes HTML, preserves lines, separates business footer and rejects unsupported placeholders', () => {
    const template = { ...LETTER_STARTERS[0], id: 'example', revision: 1, enabled: true };
    const rendered = renderBusinessLetter(template, { ...input, fields: { ...input.fields, salutation: '<script>alert(1)</script>' } }, config);
    expect(rendered.snapshot.message.html).toContain('&lt;script&gt;');
    expect(rendered.snapshot.message.html).not.toContain('<script>');
    expect(rendered.snapshot.message.html).toContain('Example Product<br />EX-1 × 2');
    expect(rendered.snapshot.message.html).not.toContain('请勿直接回复');
    expect(rendered.snapshot.message.text).toContain('order@example.test');
    expect(() => validateTemplate({ ...template, body: '{{unapproved_field}}' })).toThrow('不支持的字段');
    expect(() => renderBusinessLetter(template, { ...input, to: 'one@example.test,two@example.test' }, config)).toThrow('一个完整邮箱');
    expect(() => renderBusinessLetter({ ...template, subject: '{{products}}' }, input, config)).toThrow('换行');
  });

  it('requires genuine server identity and separates template editing from sending', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await templateRoute(request({ ...LETTER_STARTERS[0], role: 'admin' }))).status).toBe(401);
    vi.mocked(auth).mockResolvedValue({ user: { ...actor, role: 'customer', sessionId: 'customer-session' } } as never);
    expect((await letterRoute(request({ action: 'send', role: 'admin' }))).status).toBe(403);
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
  });

  it('allows a content editor to manage templates but not approve external letters', async () => {
    const db = getTestDb();
    db.exec("DELETE FROM AdminUserRole; INSERT INTO AdminRole (id,key,name,updatedAt) VALUES ('content-only','content_only','Content',datetime('now')); INSERT INTO AdminUserRole (userId,roleId) VALUES ('admin_test_id','content-only'); INSERT INTO AdminRolePermission (roleId,permissionId) VALUES ('content-only','perm_content_write');");
    expect((await templateRoute(request({ ...LETTER_STARTERS[0] }))).status).toBe(200);
    expect((await letterRoute(request({ action: 'preview', ...input }))).status).toBe(403);
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
  });

  it('previews an unsaved template without persistence or external sending', async () => {
    const response = await templateRoute(request({ ...LETTER_STARTERS[0], action: 'preview' }));
    expect(response.status).toBe(200);
    expect((await response.json()).message.html).toContain('示例产品');
    expect(getTestDb().prepare('SELECT count(*) AS n FROM BusinessLetterTemplate').get()).toEqual({ n: 0 });
    expect(getTestDb().prepare('SELECT count(*) AS n FROM BusinessLetterDraft').get()).toEqual({ n: 0 });
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
  });

  it('uses optimistic template revisions and invalidates previews after any template change', async () => {
    const { template, draft } = await makeDraft();
    const changed = await saveLetterTemplate({ ...template, body: template.body + '\n新增条件' }, actor);
    expect(changed.revision).toBe(2);
    await expect(saveLetterTemplate({ ...template, name: 'stale edit' }, actor)).rejects.toThrow('其他人修改');
    await expect(approveBusinessLetter(draft.id, draft.approvalHash, actor)).rejects.toThrow('重新预览');
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
  });

  it('retains one immutable message and one provider call across manual and worker retries', async () => {
    const { template, draft } = await makeDraft();
    const repeated = await prepareBusinessLetter({ ...input, templateId: template.id, templateRevision: template.revision }, actor);
    expect(repeated.id).toBe(draft.id);
    expect((await dispatchApprovedBusinessLetter(draft.id)).status).toBe('draft');
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
    await expect(approveBusinessLetter(draft.id, '0'.repeat(64), actor)).rejects.toThrow('当前完整预览');
    await approveBusinessLetter(draft.id, draft.approvalHash, actor);
    expect((await dispatchApprovedBusinessLetter(draft.id)).status).toBe('accepted');
    expect((await dispatchApprovedBusinessLetter(draft.id)).status).toBe('accepted');
    const rendered = JSON.parse(draft.snapshot).message;
    expect(sendBusinessMailNow).toHaveBeenCalledExactlyOnceWith(rendered, `business-letter-${draft.deliveryKey}`);
    expect(JSON.parse((await getLetterDraft(draft.id)).result!).providerMessageId).toBe('example-provider-id');
    expect(await prisma.auditLog.count({ where: { targetId: draft.id } })).toBe(3);
  });

  it('refuses changed sender configuration and revoked approver permission', async () => {
    const { draft } = await makeDraft();
    await approveBusinessLetter(draft.id, draft.approvalHash, actor);
    vi.stubEnv('BUSINESS_MAIL_REPLY_TO', 'changed@example.test');
    await expect(dispatchApprovedBusinessLetter(draft.id)).rejects.toThrow('重新预览');
    vi.stubEnv('BUSINESS_MAIL_REPLY_TO', config.replyTo);
    await prisma.user.update({ where: { id: actor.id }, data: { role: 'customer' } });
    await expect(dispatchApprovedBusinessLetter(draft.id)).rejects.toThrow('没有商务发函权限');
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'rejected', 'not_sent'] as const)('keeps %s result and never resends it', async state => {
    const { draft } = await makeDraft(); await approveBusinessLetter(draft.id, draft.approvalHash, actor);
    vi.mocked(sendBusinessMailNow).mockResolvedValue({ ok: false, provider: 'resend', deliveryState: state, error: 'retained failure' });
    const result = await dispatchApprovedBusinessLetter(draft.id);
    expect(result.status).toBe(state === 'unknown' ? 'unknown' : 'rejected');
    await dispatchApprovedBusinessLetter(draft.id);
    expect(sendBusinessMailNow).toHaveBeenCalledTimes(1);
    expect((await getLetterDraft(draft.id)).result).toContain('retained failure');
  });

  it('does not reclaim an interrupted send or treat a skipped provider as delivered', async () => {
    const { draft } = await makeDraft(); await approveBusinessLetter(draft.id, draft.approvalHash, actor);
    await prisma.$executeRaw`UPDATE BusinessLetterDraft SET status='sending' WHERE id=${draft.id}`;
    expect((await dispatchApprovedBusinessLetter(draft.id)).status).toBe('sending');
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
    const template = await saveLetterTemplate({ ...LETTER_STARTERS[0], subject: '不同信函 {{business_reference}}', enabled: true }, actor);
    const other = await prepareBusinessLetter({ ...input, templateId: template.id, templateRevision: template.revision }, actor);
    await approveBusinessLetter(other.id, other.approvalHash, actor);
    vi.mocked(sendBusinessMailNow).mockResolvedValue({ ok: true, skipped: true, provider: 'disabled' });
    expect((await dispatchApprovedBusinessLetter(other.id)).status).toBe('unknown');
  });

  it('refuses unsourced automatic preparation and does not send previews', async () => {
    const { template } = await makeDraft();
    await expect(prepareBusinessLetter({ ...input, templateId: template.id, templateRevision: template.revision }, actor, 'worker')).rejects.toThrow('原业务任务');
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
  });

  it.each(['accepted', 'unknown'] as const)('keeps %s identity across template versions and unused field changes', async state => {
    const template = await saveLetterTemplate({ name: 'Stable letter', subject: '固定主题', body: '{{details}}', enabled: true }, actor);
    const preparedInput = { ...input, templateId: template.id, templateRevision: template.revision };
    const first = await prepareBusinessLetter(preparedInput, actor);
    await approveBusinessLetter(first.id, first.approvalHash, actor);
    vi.mocked(sendBusinessMailNow).mockResolvedValue(state === 'accepted'
      ? { ok: true, provider: 'resend', deliveryState: state, providerMessageId: 'example-provider-id' }
      : { ok: false, provider: 'resend', deliveryState: state, error: 'timeout' });
    await dispatchApprovedBusinessLetter(first.id);
    const updated = await saveLetterTemplate({ ...template, name: 'Renamed template' }, actor);
    const again = await prepareBusinessLetter({ ...preparedInput, templateRevision: updated.revision,
      fields: { ...input.fields, signature: 'Unused changed field' } }, actor);
    expect(again.id).toBe(first.id);
    await dispatchApprovedBusinessLetter(again.id);
    expect(sendBusinessMailNow).toHaveBeenCalledTimes(1);
  });

  it('prevents two pre-existing drafts of the same message from both claiming delivery', async () => {
    const firstTemplate = await saveLetterTemplate({ name: 'First', subject: '固定主题', body: '{{details}}', enabled: true }, actor);
    const secondTemplate = await saveLetterTemplate({ name: 'Second', subject: '固定主题', body: '{{details}}', enabled: true }, actor);
    const first = await prepareBusinessLetter({ ...input, templateId: firstTemplate.id, templateRevision: 1 }, actor);
    const second = await prepareBusinessLetter({ ...input, templateId: secondTemplate.id, templateRevision: 1 }, actor);
    expect(second.id).not.toBe(first.id); expect(second.deliveryKey).toBe(first.deliveryKey);
    await approveBusinessLetter(first.id, first.approvalHash, actor); await approveBusinessLetter(second.id, second.approvalHash, actor);
    await dispatchApprovedBusinessLetter(first.id);
    await expect(dispatchApprovedBusinessLetter(second.id)).rejects.toThrow('相同内容');
    expect(sendBusinessMailNow).toHaveBeenCalledTimes(1);
    expect(() => getTestDb().prepare("UPDATE BusinessLetterDraft SET status='sending' WHERE id=?").run(second.id)).toThrow('UNIQUE');
  });

  it('uses the same source and template for manual/automatic preparation and blocks changed quantities', async () => {
    const brand = await prisma.brand.create({ data: { name: 'Example High Brand', defaultDiscountRate: 0.8, supplierQuoteRequiredAbove: 10000 } });
    const product = await prisma.product.create({ data: { name: 'Example high pack', brand: brand.name, brandRecordId: brand.id, catalogNumber: 'EX-HIGH', price: 16000, originalPrice: 20000 } });
    const inquiry = await prisma.inquiry.create({ data: { email: 'customer@example.test', name: 'Example customer', phone: '0', institution: 'Example', inquiryItems: {
      create: { id: 'example-letter-item', position: 0, productId: product.id, name: product.name, catalogNumber: product.catalogNumber, quantity: 1 },
    } } });
    const review = await prepareSupplierQuoteReview(prisma, { inquiryId: inquiry.id, inquiryItemId: 'example-letter-item', actor });
    const template = await saveLetterTemplate({ ...LETTER_STARTERS[0], enabled: true }, actor);
    const preparedInput = { ...input, templateId: template.id, templateRevision: template.revision, reviewId: review.reviewId };
    const manual = await prepareBusinessLetter(preparedInput, actor);
    const automatic = await prepareBusinessLetter(preparedInput, actor, 'worker');
    expect(automatic.id).toBe(manual.id);
    expect(JSON.parse(manual.snapshot).message.text).toContain('EX-HIGH');
    expect(JSON.parse(manual.snapshot).message.text).not.toContain('customer@example.test');
    await approveBusinessLetter(manual.id, manual.approvalHash, actor);
    const successor = await prepareSupplierQuoteReview(prisma, { inquiryId: inquiry.id, inquiryItemId: 'example-letter-item', actor, renewalReason: 'Request updated supplier response' });
    expect(successor.reviewId).not.toBe(review.reviewId);
    await expect(dispatchApprovedBusinessLetter(manual.id)).rejects.toThrow('新一轮询价取代');
    await prisma.inquiryItem.update({ where: { id: 'example-letter-item' }, data: { quantity: 2 } });
    await expect(dispatchApprovedBusinessLetter(manual.id)).rejects.toThrow();
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: review.reviewId } })).status).toBe('awaiting_human');
  });
});
