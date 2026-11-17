import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getAdminPermissions } from '@/lib/admin-user-permissions';
import { sendBusinessMailNow, businessMailAvailable } from '@/lib/mail';
import { loadSupplierQuoteScope } from '@/lib/supplier-quote-review';
import { type LetterTemplate } from '@/lib/business-letter-content';
import { LetterError, boundedText, letterHash, renderBusinessLetter, validateTemplate } from '@/lib/business-letter-render';
import { letterContactSource } from '@/lib/business-letter-contacts';

type Db = Prisma.TransactionClient | typeof prisma;
type Actor = { id: string; email: string };
type Snapshot = ReturnType<typeof renderBusinessLetter>['snapshot'] & { source: Awaited<ReturnType<typeof sourceFor>>;
  contact?: Awaited<ReturnType<typeof letterContactSource>> };
export type LetterDraft = {
  id: string; templateId: string; templateRevision: number; businessReference: string;
  snapshot: string; approvalHash: string; deliveryKey: string; status: string; origin: string; createdBy: string;
  approvedBy: string | null; approvedAt: string | null; result: string | null; createdAt: string; updatedAt: string;
};

function mailConfig() {
  return { from: process.env.BUSINESS_MAIL_FROM || '', replyTo: process.env.BUSINESS_MAIL_REPLY_TO || '',
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || process.env.AUTH_URL || '' };
}

export function previewLetterTemplate(input: Record<string, unknown>) {
  const template = { ...validateTemplate(input), id: 'unsaved-preview', revision: 0, enabled: true };
  return renderBusinessLetter(template, { to: 'recipient@example.test', businessReference: '示例业务编号', fields: {
    salutation: '业务负责人：', products: '示例产品\n示例货号 · 1 件', details: '此处展示本次沟通事项。', signature: '公司名称\n业务联系人',
  } }, mailConfig()).snapshot.message;
}

export async function listLetterTemplates(db: Db = prisma): Promise<LetterTemplate[]> {
  const rows = await db.$queryRaw<Array<Omit<LetterTemplate, 'enabled'> & { enabled: number }>>`SELECT * FROM BusinessLetterTemplate ORDER BY name, id`;
  return rows.map(row => ({ ...row, enabled: Boolean(row.enabled) }));
}

async function templateById(db: Db, id: string) {
  const rows = await db.$queryRaw<Array<Omit<LetterTemplate, 'enabled'> & { enabled: number }>>`SELECT * FROM BusinessLetterTemplate WHERE id = ${id}`;
  if (!rows[0]) throw new LetterError('模板不存在', 404);
  return { ...rows[0], enabled: Boolean(rows[0].enabled) };
}

export async function saveLetterTemplate(input: Record<string, unknown>, actor: Actor) {
  const data = validateTemplate(input);
  const id = input.id === undefined ? randomUUID() : boundedText(input.id, '模板编号', 100);
  const expected = input.id === undefined ? 0 : input.revision;
  if (!Number.isInteger(expected) || Number(expected) < 0) throw new LetterError('缺少模板版本');
  return prisma.$transaction(async db => {
    const before = input.id === undefined ? null : await templateById(db, id);
    const now = new Date().toISOString();
    if (before) {
      const count = await db.$executeRaw`UPDATE BusinessLetterTemplate SET name=${data.name}, subject=${data.subject}, body=${data.body}, enabled=${Number(data.enabled)}, revision=revision+1, updatedAt=${now} WHERE id=${id} AND revision=${Number(expected)}`;
      if (count !== 1) throw new LetterError('模板已被其他人修改，请重新加载后再保存', 409);
    } else {
      await db.$executeRaw`INSERT INTO BusinessLetterTemplate (id,name,subject,body,enabled,revision,updatedAt) VALUES (${id},${data.name},${data.subject},${data.body},${Number(data.enabled)},1,${now})`;
    }
    const after = await templateById(db, id);
    await writeAuditLog({ actorId: actor.id, actorEmail: actor.email, action: 'business_letter.template_saved',
      resource: 'content', targetType: 'BusinessLetterTemplate', targetId: id, before, after }, db);
    return after;
  });
}

async function sourceFor(db: Db, reviewId?: string) {
  if (!reviewId) return null;
  const review = await db.backgroundTask.findUnique({ where: { id: reviewId } });
  if (!review || review.type !== 'inquiry.supplier_written_quote' || review.status !== 'awaiting_human') {
    throw new LetterError('原供应商询价任务已变化，请重新核对', 409);
  }
  const payload = JSON.parse(review.payload) as { scope: { inquiryId: string; inquiryItemId: string; quantity: number }; sourceHash: string; requestHash: string };
  const current = await loadSupplierQuoteScope(db, payload.scope.inquiryId, payload.scope.inquiryItemId, payload.scope.quantity, true);
  if (current.requestHash !== payload.sourceHash) throw new LetterError('原询价商品、数量或条件已变化，请重新准备询价', 409);
  const metadata = JSON.parse(current.item.metadata || '{}');
  if (metadata.supplierQuoteRequests?.[String(payload.scope.quantity)] !== reviewId) {
    throw new LetterError('原供应商询价任务已被新一轮询价取代，请使用当前任务重新准备信函', 409);
  }
  return { reviewId, requestHash: payload.requestHash, sourceHash: current.requestHash, scope: current.scope };
}

export async function getLetterDraft(id: string, db: Db = prisma): Promise<LetterDraft> {
  const rows = await db.$queryRaw<LetterDraft[]>`SELECT * FROM BusinessLetterDraft WHERE id=${id}`;
  if (!rows[0]) throw new LetterError('信函不存在', 404);
  return rows[0];
}

export async function listLetterDrafts() {
  return prisma.$queryRaw<LetterDraft[]>`SELECT * FROM BusinessLetterDraft ORDER BY createdAt DESC LIMIT 50`;
}

/** Manual and worker preparation share this exact path. Preparation never approves or sends. */
export async function prepareBusinessLetter(input: {
  templateId: string; templateRevision: number; to: unknown; fields: unknown; businessReference: unknown; reviewId?: string;
  contactId?: unknown; contactRevision?: unknown;
}, actor: Actor, origin: 'manual' | 'worker' = 'manual') {
  if (origin === 'worker' && !input.reviewId) throw new LetterError('自动准备信函须关联原业务任务');
  return prisma.$transaction(async db => {
    const template = await templateById(db, boundedText(input.templateId, '模板编号', 100));
    if (template.revision !== input.templateRevision) throw new LetterError('模板已更新，请重新选择并预览', 409);
    const source = await sourceFor(db, input.reviewId ? boundedText(input.reviewId, '原询价任务', 100) : undefined);
    const fields = input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields) ? input.fields : {};
    const renderingInput = source ? { ...input, fields: { ...fields,
      products: `${source.scope.brand}\n${source.scope.name}\n货号：${source.scope.catalogNumber}\n${source.scope.specification ? `规格：${source.scope.specification}\n` : ''}数量：${source.scope.quantity}`,
    } } : input;
    const rendered = renderBusinessLetter(template, renderingInput, mailConfig());
    const contact = input.contactId === undefined ? undefined : await letterContactSource(db, input.contactId, input.contactRevision, input.to);
    const snapshot: Snapshot = { ...rendered.snapshot, source, ...(contact ? { contact } : {}) };
    const approvalHash = letterHash(snapshot);
    const deliveryKey = letterHash(snapshot.message);
    const previousSend = await db.$queryRaw<LetterDraft[]>`SELECT * FROM BusinessLetterDraft WHERE deliveryKey=${deliveryKey} AND status IN ('sending','accepted','rejected','unknown') LIMIT 1`;
    if (previousSend[0]) return previousSend[0];
    const now = new Date().toISOString();
    const id = randomUUID();
    // The unique content identity is shared by manual/worker callers and survives retries.
    const added = await db.$executeRaw`INSERT OR IGNORE INTO BusinessLetterDraft
      (id,templateId,templateRevision,businessReference,snapshot,approvalHash,deliveryKey,status,origin,createdBy,createdAt,updatedAt)
      VALUES (${id},${template.id},${template.revision},${snapshot.businessReference},${JSON.stringify(snapshot)},${approvalHash},${deliveryKey},'draft',${origin},${actor.id},${now},${now})`;
    if (added) await writeAuditLog({ actorId: actor.id, actorEmail: actor.email, action: 'business_letter.prepared', resource: 'inquiries',
      targetType: 'BusinessLetterDraft', targetId: id, after: { approvalHash, templateId: template.id, revision: template.revision, origin } }, db);
    const rows = await db.$queryRaw<LetterDraft[]>`SELECT * FROM BusinessLetterDraft WHERE approvalHash=${approvalHash}`;
    return rows[0];
  });
}

async function validateSnapshot(db: Db, draft: LetterDraft) {
  const snapshot = JSON.parse(draft.snapshot) as Snapshot;
  if (letterHash(snapshot) !== draft.approvalHash || letterHash(snapshot.message) !== draft.deliveryKey) throw new LetterError('预览内容校验失败', 409);
  const template = await templateById(db, draft.templateId);
  if (template.revision !== draft.templateRevision || !template.enabled) throw new LetterError('模板已修改或停用，请重新预览确认', 409);
  const source = await sourceFor(db, snapshot.source?.reviewId);
  const contact = snapshot.contact ? await letterContactSource(db, snapshot.contact.id, snapshot.contact.revision, snapshot.message.to[0]) : undefined;
  const regenerated = renderBusinessLetter(template, { to: snapshot.message.to[0], fields: snapshot.fields, businessReference: snapshot.businessReference }, mailConfig());
  if (letterHash({ ...regenerated.snapshot, source, ...(contact ? { contact } : {}) }) !== draft.approvalHash) throw new LetterError('业务、联系人、发件配置或模板已变化，请重新预览确认', 409);
  return snapshot;
}

async function requireCurrentSender(db: Db, id: string) {
  const user = await db.user.findUnique({ where: { id } });
  if (!user || user.role !== 'admin' || user.isFrozen || user.approvalStatus !== 'approved'
    || !(await getAdminPermissions(user)).includes('inquiries.write')) throw new LetterError('当前账号没有商务发函权限', 403);
  return user;
}

export async function approveBusinessLetter(id: string, approvalHash: string, actor: Actor) {
  return prisma.$transaction(async db => {
    await requireCurrentSender(db, actor.id);
    const draft = await getLetterDraft(id, db);
    if (draft.approvalHash !== approvalHash) throw new LetterError('请确认当前完整预览', 409);
    if (draft.status !== 'draft') return draft;
    await validateSnapshot(db, draft);
    const now = new Date().toISOString();
    const n = await db.$executeRaw`UPDATE BusinessLetterDraft SET status='approved',approvedBy=${actor.id},approvedAt=${now},updatedAt=${now} WHERE id=${id} AND status='draft' AND approvalHash=${approvalHash}`;
    if (n !== 1) throw new LetterError('信函状态已变化，请刷新', 409);
    await writeAuditLog({ actorId: actor.id, actorEmail: actor.email, action: 'business_letter.approved', resource: 'inquiries',
      targetType: 'BusinessLetterDraft', targetId: id, after: { approvalHash, templateRevision: draft.templateRevision } }, db);
    return getLetterDraft(id, db);
  });
}

/** Both the manual route and existing email worker dispatch only an approved immutable snapshot. */
export async function dispatchApprovedBusinessLetter(id: string) {
  if (!businessMailAvailable()) {
    throw new LetterError('商务发信尚未启用，已确认信函会保留', 503);
  }
  const claim = await prisma.$transaction(async db => {
    const draft = await getLetterDraft(id, db);
    if (draft.status !== 'approved') return null;
    if (!draft.approvedBy) throw new LetterError('缺少人工发送确认', 409);
    await requireCurrentSender(db, draft.approvedBy);
    const snapshot = await validateSnapshot(db, draft);
    const previousSend = await db.$queryRaw<LetterDraft[]>`SELECT * FROM BusinessLetterDraft WHERE deliveryKey=${draft.deliveryKey} AND status IN ('sending','accepted','rejected','unknown') LIMIT 1`;
    if (previousSend[0]) throw new LetterError('相同内容的信函已有发送记录，请先核对原记录，勿重复发送', 409);
    const now = new Date().toISOString();
    const claimed = await db.$executeRaw`UPDATE BusinessLetterDraft SET status='sending',updatedAt=${now} WHERE id=${id} AND status='approved'`;
    return claimed === 1 ? { draft, snapshot } : null;
  });
  if (!claim) return getLetterDraft(id);
  // Claim is committed before network I/O. A crash leaves 'sending', never an automatic resend.
  const result = await sendBusinessMailNow(claim.snapshot.message, `business-letter-${claim.draft.deliveryKey}`);
  const status = result.ok && !result.skipped && result.deliveryState === 'accepted' && result.providerMessageId ? 'accepted'
    : result.deliveryState === 'rejected' || result.deliveryState === 'not_sent' ? 'rejected' : 'unknown';
  return prisma.$transaction(async db => {
    const now = new Date().toISOString();
    await db.$executeRaw`UPDATE BusinessLetterDraft SET status=${status},result=${JSON.stringify(result)},updatedAt=${now} WHERE id=${id} AND status='sending'`;
    await writeAuditLog({ actorId: claim.draft.approvedBy, action: 'business_letter.delivery_result', resource: 'inquiries',
      targetType: 'BusinessLetterDraft', targetId: id, after: { approvalHash: claim.draft.approvalHash, status, result } }, db);
    return getLetterDraft(id, db);
  });
}
