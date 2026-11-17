import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getAdminPermissions } from '@/lib/admin-user-permissions';
import { LetterError, boundedText, letterHash, mailAddress } from '@/lib/business-letter-render';

type Db = Prisma.TransactionClient | typeof prisma;
type Actor = { id: string; email: string };
export type LetterContactData = {
  companyName: string; contactName: string; salutation: string; email: string;
  phone: string; qq: string; brandIds: string[]; notes: string; sourceReference: string; enabled: boolean;
};
export type LetterContact = LetterContactData & {
  id: string; revision: number; updatedAt: string; brands: { id: string; name: string }[];
};
type ContactRow = Omit<LetterContact, 'brandIds' | 'brands' | 'enabled'> & { brandIds: string; enabled: number };

function contactData(raw: Record<string, unknown>): LetterContactData {
  const text = (key: string, label: string, max: number, required = false) => boundedText(raw[key] ?? '', label, max, required);
  const email = text('email', '邮箱', 254);
  const data = {
    companyName: text('companyName', '供应商或公司名称', 160, true),
    contactName: text('contactName', '联系人姓名', 80, true),
    salutation: text('salutation', '信函称呼', 100), email: email ? mailAddress(email) : '',
    phone: text('phone', '电话', 80), qq: text('qq', 'QQ', 80),
    notes: text('notes', '内部备注', 2000), sourceReference: text('sourceReference', '资料来源', 2000),
    brandIds: raw.brandIds, enabled: raw.enabled,
  };
  if (!data.email && !data.phone && !data.qq) throw new LetterError('请至少填写邮箱、电话或 QQ 中的一项');
  if (typeof data.enabled !== 'boolean' || !Array.isArray(data.brandIds) || data.brandIds.length > 50
    || data.brandIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 100)
    || new Set(data.brandIds).size !== data.brandIds.length) throw new LetterError('品牌或启用状态不正确');
  return { ...data, brandIds: [...data.brandIds].sort() } as LetterContactData;
}

async function brandsFor(db: Db, ids: string[]) {
  const brands = await db.brand.findMany({ where: { id: { in: ids } }, select: { id: true, name: true }, orderBy: { id: 'asc' } });
  if (brands.length !== ids.length) throw new LetterError('关联品牌已变化，请重新选择', 409);
  return brands;
}

async function readContact(db: Db, id: string): Promise<LetterContact> {
  const rows = await db.$queryRaw<ContactRow[]>`SELECT id,companyName,contactName,salutation,email,phone,qq,brandIds,notes,sourceReference,enabled,revision,updatedAt FROM BusinessLetterContact WHERE id=${id}`;
  if (!rows[0]) throw new LetterError('联系人不存在，请刷新通讯录', 404);
  const row = rows[0];
  const brandIds = JSON.parse(row.brandIds) as string[];
  return { ...row, enabled: Boolean(row.enabled), brandIds, brands: await brandsFor(db, brandIds) };
}

export async function listLetterContacts(search = '') {
  const query = boundedText(search, '检索内容', 160, false);
  const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`SELECT c.id FROM BusinessLetterContact c
    WHERE c.companyName LIKE ${pattern} ESCAPE '\\' OR c.contactName LIKE ${pattern} ESCAPE '\\'
      OR c.email LIKE ${pattern} ESCAPE '\\' OR c.phone LIKE ${pattern} ESCAPE '\\' OR c.qq LIKE ${pattern} ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM json_each(c.brandIds) j JOIN Brand b ON b.id=j.value WHERE b.name LIKE ${pattern} ESCAPE '\\')
    ORDER BY c.enabled DESC,c.companyName,c.contactName,c.id LIMIT 101`;
  return { contacts: await Promise.all(rows.slice(0, 100).map(row => readContact(prisma, row.id))), hasMore: rows.length > 100 };
}

async function previewIn(db: Db, input: Record<string, unknown>) {
  const data = contactData(input);
  const id = input.id === undefined ? null : boundedText(input.id, '联系人编号', 100);
  const revision = id ? input.revision : 0;
  if (!Number.isInteger(revision) || Number(revision) < 0) throw new LetterError('缺少联系人版本');
  const before = id ? await readContact(db, id) : null;
  if (before && before.revision !== revision) throw new LetterError('联系人已被其他人修改，请重新加载后核对', 409);
  const after = { ...data, brands: await brandsFor(db, data.brandIds) };
  return { id, revision: Number(revision), before, after,
    previewHash: letterHash({ id, revision, before, after }) };
}

export async function previewLetterContact(input: Record<string, unknown>) {
  return prisma.$transaction(db => previewIn(db, input));
}

export async function saveLetterContact(input: Record<string, unknown>, actor: Actor) {
  return prisma.$transaction(async db => {
    const user = await db.user.findUnique({ where: { id: actor.id } });
    if (!user || user.role !== 'admin' || user.isFrozen || user.approvalStatus !== 'approved'
      || !(await getAdminPermissions(user)).includes('inquiries.write')) throw new LetterError('当前账号没有通讯录维护权限', 403);
    const preview = await previewIn(db, input);
    if (input.confirm !== true || input.previewHash !== preview.previewHash) throw new LetterError('请先预览并确认当前联系人资料', 409);
    const id = preview.id || `contact_${preview.previewHash}`;
    const d = preview.after; const now = new Date().toISOString(); const brands = JSON.stringify(d.brandIds);
    if (preview.before) {
      const n = await db.$executeRaw`UPDATE BusinessLetterContact SET companyName=${d.companyName},contactName=${d.contactName},salutation=${d.salutation},email=${d.email},phone=${d.phone},qq=${d.qq},brandIds=${brands},notes=${d.notes},sourceReference=${d.sourceReference},enabled=${Number(d.enabled)},revision=revision+1,updatedAt=${now},updatedBy=${actor.id} WHERE id=${id} AND revision=${preview.revision}`;
      if (n !== 1) throw new LetterError('联系人已被其他人修改，请重新加载后核对', 409);
    } else {
      const n = await db.$executeRaw`INSERT OR IGNORE INTO BusinessLetterContact (id,companyName,contactName,salutation,email,phone,qq,brandIds,notes,sourceReference,enabled,revision,updatedAt,updatedBy) VALUES (${id},${d.companyName},${d.contactName},${d.salutation},${d.email},${d.phone},${d.qq},${brands},${d.notes},${d.sourceReference},${Number(d.enabled)},1,${now},${actor.id})`;
      if (n === 0) {
        const existing = await readContact(db, id);
        if (existing.revision !== 1 || letterHash({ ...contactData(existing), brands: existing.brands }) !== letterHash(d)) {
          throw new LetterError('此前确认的联系人已保存并修改，请重新加载后核对', 409);
        }
        return existing;
      }
    }
    const after = await readContact(db, id);
    await writeAuditLog({ actorId: actor.id, actorEmail: user.email, action: 'business_letter.contact_saved', resource: 'inquiries',
      targetType: 'BusinessLetterContact', targetId: id, before: preview.before, after }, db);
    return after;
  });
}

/** Contact identity joins the exact message approval; directory edits cannot redirect an approved letter. */
export async function letterContactSource(db: Db, id: unknown, revision: unknown, to: unknown) {
  const contact = await readContact(db, boundedText(id, '联系人编号', 100));
  if (!contact.enabled || !contact.email || contact.revision !== revision) throw new LetterError('联系人已修改或停用，请重新选择并预览', 409);
  if (contact.email.toLowerCase() !== mailAddress(to).toLowerCase()) throw new LetterError('收件地址与所选联系人不一致，请重新选择或改用手工填写', 409);
  return { id: contact.id, revision: contact.revision, companyName: contact.companyName, contactName: contact.contactName,
    email: contact.email, salutation: contact.salutation, brands: contact.brands };
}
