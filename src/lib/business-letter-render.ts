import { createHash } from 'node:crypto';
import { LETTER_FIELDS, type LetterTemplate, type LetterFields } from '@/lib/business-letter-content';
import { renderBrandedMailHtml, renderBrandedMailText } from '@/lib/mail-templates';

export class LetterError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function boundedText(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new LetterError(`${label}未填写或格式不正确`);
  }
  return value.trim();
}

export function mailAddress(value: unknown): string {
  const email = boundedText(value, '邮箱地址', 254);
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(email)) {
    throw new LetterError('请填写一个完整邮箱地址，不支持抄送、密送或多个收件人');
  }
  return email;
}

function fieldsIn(value: string): string[] {
  const fields = Array.from(value.matchAll(/{{([a-z_]+)}}/g), match => match[1]);
  if (fields.some(field => !Object.hasOwn(LETTER_FIELDS, field)) || /{{|}}/.test(value.replace(/{{[a-z_]+}}/g, ''))) {
    throw new LetterError('模板包含不支持的字段，请使用页面列出的字段');
  }
  return fields;
}

export function validateTemplate(value: Record<string, unknown>) {
  const name = boundedText(value.name, '模板名称', 80);
  const subject = boundedText(value.subject, '主题', 200);
  const body = boundedText(value.body, '正文', 16000);
  if (/[\r\n]/.test(subject) || typeof value.enabled !== 'boolean') throw new LetterError('主题或启用状态不正确');
  fieldsIn(subject); fieldsIn(body);
  return { name, subject, body, enabled: value.enabled };
}

export function renderBusinessLetter(template: LetterTemplate, input: {
  to: unknown; fields: unknown; businessReference: unknown;
}, config: { from: string; replyTo: string; siteUrl: string }) {
  if (!template.enabled) throw new LetterError('模板已停用，请选择启用的模板', 409);
  const to = mailAddress(input.to);
  const from = mailAddress(config.from);
  const replyTo = mailAddress(config.replyTo);
  const siteUrl = new URL(config.siteUrl);
  if (siteUrl.protocol !== 'https:' || siteUrl.username || siteUrl.password) throw new LetterError('商务邮件站点地址未正确配置', 503);
  const businessReference = boundedText(input.businessReference, '业务编号', 160);
  const raw = input.fields && typeof input.fields === 'object' && !Array.isArray(input.fields) ? input.fields as Record<string, unknown> : {};
  const values = Object.fromEntries(Object.keys(LETTER_FIELDS).map(key => [key,
    key === 'business_reference' ? businessReference : boundedText(raw[key] ?? '', LETTER_FIELDS[key as keyof LetterFields], 6000, false),
  ])) as LetterFields;
  const interpolate = (text: string) => {
    for (const key of fieldsIn(text)) if (!values[key as keyof LetterFields]) throw new LetterError(`请填写${LETTER_FIELDS[key as keyof LetterFields]}`);
    return text.replace(/{{([a-z_]+)}}/g, (_, key: keyof LetterFields) => values[key]);
  };
  const subject = interpolate(template.subject);
  if (subject.length > 250 || /[\r\n]/.test(subject)) throw new LetterError('生成的主题过长或含有换行');
  const body = interpolate(template.body);
  const content = { headline: subject, paragraphs: body.split(/\n\s*\n/), correspondence: { replyTo } };
  const message = { from: `LIBEREAL <${from}>`, replyTo, to: [to], subject,
    html: renderBrandedMailHtml(content, siteUrl.origin), text: renderBrandedMailText(content, siteUrl.origin) };
  const snapshot = { templateId: template.id, templateRevision: template.revision, businessReference, fields: values, message };
  return { snapshot, approvalHash: letterHash(snapshot) };
}

export function letterHash(snapshot: unknown): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
