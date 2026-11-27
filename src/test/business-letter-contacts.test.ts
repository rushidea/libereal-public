import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/mail', () => ({ sendBusinessMailNow: vi.fn(), businessMailAvailable: vi.fn(() => true) }));
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sendBusinessMailNow } from '@/lib/mail';
import { previewLetterContact, saveLetterContact, listLetterContacts } from '@/lib/business-letter-contacts';
import { saveLetterTemplate, prepareBusinessLetter, approveBusinessLetter, dispatchApprovedBusinessLetter } from '@/lib/business-letters';
import { LETTER_STARTERS } from '@/lib/business-letter-content';
import { GET, POST } from '@/app/api/admin/business-letter-contacts/route';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

const actor = { id: 'admin_test_id', email: 'admin@test.com' };
const data = { companyName: 'Example Supplier', contactName: 'Example Person', salutation: '业务负责人：',
  email: 'supplier@example.test', phone: '000-123', qq: '100001', brandIds: ['contact-brand'], notes: 'Internal note', sourceReference: 'Owner provided address', enabled: true };
const fields = { salutation: '业务负责人：', products: 'EX-1 × 1', details: '请确认供货信息。', signature: 'Example Company' };
const request = (body: unknown) => new NextRequest('http://localhost/api/admin/business-letter-contacts', { method: 'POST', body: JSON.stringify(body) });
async function save(input: Record<string, unknown> = data) {
  const preview = await previewLetterContact(input);
  return saveLetterContact({ ...input, previewHash: preview.previewHash, confirm: true }, actor);
}
async function draft(contact: Awaited<ReturnType<typeof save>>) {
  const template = await saveLetterTemplate({ ...LETTER_STARTERS[0], enabled: true }, actor);
  return prepareBusinessLetter({ templateId: template.id, templateRevision: template.revision, to: contact.email,
    businessReference: 'INQ-EXAMPLE', fields, contactId: contact.id, contactRevision: contact.revision }, actor);
}

describe('private business correspondence directory', () => {
  beforeAll(() => {
    const db = getTestDb();
    db.exec('DROP TABLE IF EXISTS BusinessLetterDraft; DROP TABLE IF EXISTS BusinessLetterTemplate; DROP TABLE IF EXISTS BusinessLetterContact;');
    db.exec(readFileSync('prisma/migrations/20261117010000_business_letter_templates/migration.sql', 'utf8'));
    db.exec(readFileSync('prisma/migrations/20261117020000_business_letter_contacts/migration.sql', 'utf8'));
  });
  beforeEach(() => {
    const db = getTestDb(); db.exec('DELETE FROM BusinessLetterDraft; DELETE FROM BusinessLetterTemplate; DELETE FROM BusinessLetterContact;');
    clearAllTables(db); seedAdmin(db); vi.clearAllMocks();
    db.prepare('INSERT INTO Brand (id,name,updatedAt) VALUES (?,?,?)').run('contact-brand', 'Example Brand', new Date().toISOString());
    vi.mocked(auth).mockResolvedValue({ user: { ...actor, role: 'admin', sessionId: 'contacts-session' } } as never);
    vi.mocked(sendBusinessMailNow).mockResolvedValue({ ok: true, provider: 'resend', deliveryState: 'accepted', providerMessageId: 'example-only' });
    vi.stubEnv('BUSINESS_MAIL_FROM', 'order@example.test'); vi.stubEnv('BUSINESS_MAIL_REPLY_TO', 'order@example.test'); vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://example.test');
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => { await prisma.$disconnect(); closeTestDb(); });

  it('keeps contact data behind genuine administrator permissions', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    expect((await GET(new NextRequest('http://localhost/api/admin/business-letter-contacts'))).status).toBe(401);
    vi.mocked(auth).mockResolvedValue({ user: { ...actor, role: 'customer', sessionId: 'customer-session' } } as never);
    expect((await POST(request({ ...data, action: 'save', role: 'admin', confirm: true }))).status).toBe(403);
    const db = getTestDb(); db.exec("UPDATE User SET isFrozen=1 WHERE id='admin_test_id'");
    await expect(save()).rejects.toThrow('没有通讯录维护权限');
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
  });

  it('requires the exact displayed changes and a confirmation before activation', async () => {
    const preview = await previewLetterContact(data);
    expect((await listLetterContacts()).contacts).toHaveLength(0);
    await expect(saveLetterContact({ ...data, previewHash: preview.previewHash }, actor)).rejects.toThrow('预览并确认');
    await expect(saveLetterContact({ ...data, email: 'changed@example.test', previewHash: preview.previewHash, confirm: true }, actor)).rejects.toThrow('预览并确认');
    const contact = await save();
    expect(contact).toMatchObject({ enabled: true, revision: 1, brands: [{ id: 'contact-brand', name: 'Example Brand' }] });
    expect(getTestDb().prepare("SELECT actorId FROM AuditLog WHERE action='business_letter.contact_saved'").get()).toEqual({ actorId: actor.id });
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
  });

  it('reuses a confirmed creation after a lost response without duplicate records or audits', async () => {
    const preview = await previewLetterContact(data);
    const input = { ...data, previewHash: preview.previewHash, confirm: true };
    const first = await saveLetterContact(input, actor);
    expect(await saveLetterContact(input, actor)).toEqual(first);
    expect((await listLetterContacts()).contacts).toHaveLength(1);
    expect(getTestDb().prepare("SELECT COUNT(*) AS n FROM AuditLog WHERE action='business_letter.contact_saved'").get()).toEqual({ n: 1 });
    await save({ ...first, enabled: false });
    await expect(saveLetterContact(input, actor)).rejects.toThrow('已保存并修改');
    expect((await listLetterContacts()).contacts[0]).toMatchObject({ id: first.id, enabled: false, revision: 2 });
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
  });

  it('finds company, brand, person, email, phone and QQ with literal wildcard escaping', async () => {
    const contact = await save({ ...data, companyName: 'Example% Supplier' });
    for (const query of ['Example%', 'Example Brand', 'Person', 'supplier@example.test', '000-123', '100001']) {
      expect((await listLetterContacts(query)).contacts.map(c => c.id)).toEqual([contact.id]);
    }
    expect((await listLetterContacts("%' OR 1=1 --")).contacts).toHaveLength(0);
    expect((await listLetterContacts('_')).contacts).toHaveLength(0);
  });

  it('rejects stale edits and source brand changes after preview', async () => {
    const contact = await save(); const preview = await previewLetterContact({ ...contact, phone: 'new-phone' });
    await save({ ...contact, qq: 'new-qq' });
    await expect(saveLetterContact({ ...contact, phone: 'new-phone', previewHash: preview.previewHash, confirm: true }, actor)).rejects.toThrow('其他人修改');
    const another = await previewLetterContact(data);
    getTestDb().exec("UPDATE Brand SET name='Changed Brand' WHERE id='contact-brand'");
    await expect(saveLetterContact({ ...data, previewHash: another.previewHash, confirm: true }, actor)).rejects.toThrow('预览并确认');
  });

  it('invalidates approved letters after contact changes and never redirects them', async () => {
    const contact = await save(); const letter = await draft(contact);
    await approveBusinessLetter(letter.id, letter.approvalHash, actor);
    const changed = await save({ ...contact, email: 'new-supplier@example.test' });
    await expect(dispatchApprovedBusinessLetter(letter.id)).rejects.toThrow('联系人已修改');
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
    const revised = await draft(changed); await approveBusinessLetter(revised.id, revised.approvalHash, actor); await dispatchApprovedBusinessLetter(revised.id);
    expect(sendBusinessMailNow).toHaveBeenCalledOnce();
    expect(vi.mocked(sendBusinessMailNow).mock.calls[0][0].to).toEqual(['new-supplier@example.test']);
    expect(JSON.parse(revised.snapshot).message.text).not.toContain('Internal note');
  });

  it('requires selected recipient and revision, and blocks disabled or QQ-only contacts', async () => {
    const contact = await save(); const template = await saveLetterTemplate({ ...LETTER_STARTERS[0], enabled: true }, actor);
    const input = { templateId: template.id, templateRevision: template.revision, to: 'other@example.test', businessReference: 'INQ-EXAMPLE', fields, contactId: contact.id, contactRevision: contact.revision };
    await expect(prepareBusinessLetter(input, actor)).rejects.toThrow('收件地址');
    await expect(prepareBusinessLetter({ ...input, to: contact.email, contactRevision: 999 }, actor)).rejects.toThrow('联系人已修改');
    const disabled = await save({ ...contact, enabled: false }); await expect(draft(disabled)).rejects.toThrow('停用');
    const qqOnly = await save({ ...data, email: '', phone: '' });
    await expect(prepareBusinessLetter({ ...input, to: data.email, contactId: qqOnly.id, contactRevision: qqOnly.revision }, actor)).rejects.toThrow('联系人已修改');
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
  });

  it('rejects unknown brands, invalid emails and unusable contact records', async () => {
    await expect(previewLetterContact({ ...data, brandIds: ['unknown'] })).rejects.toThrow('关联品牌');
    await expect(previewLetterContact({ ...data, email: 'one@example.test\r\nBcc: other@example.test' })).rejects.toThrow('完整邮箱');
    await expect(previewLetterContact({ ...data, email: '', phone: '', qq: '' })).rejects.toThrow('至少填写');
    await expect(previewLetterContact({ ...data, brandIds: ['contact-brand', 'contact-brand'] })).rejects.toThrow('品牌');
  });

  it('keeps manually addressed old snapshots valid without requiring a directory association', async () => {
    const template = await saveLetterTemplate({ ...LETTER_STARTERS[0], enabled: true }, actor);
    const letter = await prepareBusinessLetter({ templateId: template.id, templateRevision: template.revision, to: data.email, businessReference: 'MANUAL', fields }, actor);
    expect(JSON.parse(letter.snapshot)).not.toHaveProperty('contact');
    await approveBusinessLetter(letter.id, letter.approvalHash, actor); await dispatchApprovedBusinessLetter(letter.id);
    expect(sendBusinessMailNow).toHaveBeenCalledOnce();
  });

  it('invalidates contact-bound mail when the displayed brand identity changes', async () => {
    const contact = await save(); const letter = await draft(contact);
    getTestDb().exec("UPDATE Brand SET name='Changed Brand' WHERE id='contact-brand'");
    await expect(approveBusinessLetter(letter.id, letter.approvalHash, actor)).rejects.toThrow('重新预览确认');
    expect(sendBusinessMailNow).not.toHaveBeenCalled();
  });
});
