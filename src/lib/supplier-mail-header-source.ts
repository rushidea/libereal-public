import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import { mailAddress } from '@/lib/business-letter-render';

const PATH = '/api/integrations/inbox-headers';
const PAGE_SIZE = 25;
const CONFIG_BYTES = 64 * 1024;
const RESPONSE_BYTES = 160 * 1024;
const hex = /^[a-f0-9]{64}$/;
const atom = "[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+";
const messageIdPattern = new RegExp(`^${atom}(?:\\.${atom})*@${atom}(?:\\.${atom})*$`);

export type OutboundMailProof = {
  letterId: string; providerReceiptId: string; messageId: string; evidenceSha256: string;
};
export type SupplierMailHeaderSource = {
  sourceId: string; origin: string; mailbox: string; startAfter: number; key: string;
  verifiedOutbound: OutboundMailProof[];
};
export type MailHeader = { emailId: number; sender: string | null; messageId: string | null; inReplyTo: string | null };
export type MailHeaderPage = { nextAfter: number; blocked: boolean; hasMore: boolean; emails: MailHeader[] };

export function mailRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function readMailRecord(raw: string | null) {
  try { return raw ? mailRecord(JSON.parse(raw)) : {}; } catch { return {}; }
}
export function isPositiveMailId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
export function isMailHash(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && hex.test(value);
}
export function normalizeMailMessageId(value: unknown) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 998 || /[\r\n\0]/.test(value)) return null;
  const trimmed = value.trim();
  const id = trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1) : trimmed;
  // Do not change case or guess when the header contains more than one identifier.
  return messageIdPattern.test(id) ? id : null;
}
export function normalizeMailAddress(value: unknown) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) return null;
  try {
    const address = mailAddress(value);
    const at = address.lastIndexOf('@');
    return address.slice(0, at) + address.slice(at).toLowerCase();
  } catch { return null; }
}

/** Only use pairs recorded after checking the original delivered header or trusted provider evidence. */
export function parseSupplierMailHeaderSource(value: unknown): SupplierMailHeaderSource {
  const raw = mailRecord(value);
  const origin = new URL(typeof raw.origin === 'string' ? raw.origin : '');
  const mailbox = normalizeMailAddress(raw.mailbox)?.toLowerCase();
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/'
    || origin.search || origin.hash || !mailbox || !isPositiveMailId(raw.startAfter)
    || typeof raw.sourceId !== 'string' || !/^[a-z0-9_-]{1,80}$/.test(raw.sourceId)
    || !isMailHash(raw.key) || !Array.isArray(raw.verifiedOutbound) || raw.verifiedOutbound.length > 256) {
    throw new Error('收件头服务配置不正确');
  }
  const verifiedOutbound = raw.verifiedOutbound.map((entry): OutboundMailProof => {
    const proof = mailRecord(entry);
    const messageId = normalizeMailMessageId(proof.messageId);
    if (typeof proof.letterId !== 'string' || !/^[\w-]{1,120}$/.test(proof.letterId)
      || typeof proof.providerReceiptId !== 'string' || !/^[\w.-]{1,120}$/.test(proof.providerReceiptId)
      || !messageId || !isMailHash(proof.evidenceSha256)) throw new Error('发信邮件头登记不正确');
    return { letterId: proof.letterId, providerReceiptId: proof.providerReceiptId, messageId, evidenceSha256: proof.evidenceSha256 };
  });
  return { sourceId: raw.sourceId, mailbox, startAfter: raw.startAfter, origin: origin.origin, key: raw.key, verifiedOutbound };
}

export function supplierMailHeaderSource(): SupplierMailHeaderSource {
  const filename = process.env.SUPPLIER_MAIL_HEADERS_CREDENTIAL_FILE;
  if (process.env.SUPPLIER_MAIL_HEADERS_ENABLED !== '1' || !filename) {
    throw new Error('收件头接续尚未启用');
  }
  if (process.env.SUPPLIER_MAIL_INTAKE_ENABLED === '1') throw new Error('不能与原文收件候选同时启用');
  let fd: number | undefined;
  try {
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    const owner = typeof process.getuid === 'function' ? process.getuid() : -1;
    const mode = stat.mode & 0o7777;
    const privateFile = (stat.uid === owner || stat.uid === 0) && (mode === 0o400 || mode === 0o600);
    const systemdFile = stat.uid === 0 && stat.gid === 0 && mode === 0o440;
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > CONFIG_BYTES || !(privateFile || systemdFile)) throw new Error();
    const buffer = Buffer.alloc(CONFIG_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > CONFIG_BYTES) throw new Error();
    return parseSupplierMailHeaderSource(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))));
  } catch {
    throw new Error('收件头服务配置不可用');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function headerValue(value: unknown, max: number) {
  return value === null || typeof value === 'string' && Buffer.byteLength(value) <= max && !value.includes('\0');
}

export function parseMailHeaderPage(value: unknown, source: SupplierMailHeaderSource, after: number): MailHeaderPage {
  const raw = mailRecord(value);
  if (!exactKeys(raw, ['version', 'mailbox', 'nextAfter', 'blocked', 'hasMore', 'emails']) || raw.version !== 1
    || normalizeMailAddress(raw.mailbox)?.toLowerCase() !== source.mailbox || !Array.isArray(raw.emails) || raw.emails.length > PAGE_SIZE
    || typeof raw.blocked !== 'boolean' || typeof raw.hasMore !== 'boolean'
    || raw.hasMore && (raw.blocked || raw.emails.length !== PAGE_SIZE)) throw new Error('收件头服务返回的范围或分页不正确');
  let cursor = after;
  const emails = raw.emails.map((item): MailHeader => {
    const row = mailRecord(item);
    if (!exactKeys(row, ['emailId', 'sendEmail', 'messageId', 'inReplyTo'])
      || !isPositiveMailId(row.emailId) || row.emailId <= cursor
      || !headerValue(row.sendEmail, 254) || !headerValue(row.messageId, 998) || !headerValue(row.inReplyTo, 998)) {
      throw new Error('收件头服务返回了无法安全接续的邮件');
    }
    cursor = row.emailId;
    return { emailId: row.emailId, sender: normalizeMailAddress(row.sendEmail),
      messageId: normalizeMailMessageId(row.messageId), inReplyTo: normalizeMailMessageId(row.inReplyTo) };
  });
  if (raw.nextAfter !== cursor) throw new Error('收件头服务返回的游标与已返回邮件不一致');
  return { nextAfter: cursor, blocked: raw.blocked, hasMore: raw.hasMore, emails };
}

export async function fetchMailHeaderPage(source: SupplierMailHeaderSource, after: number): Promise<MailHeaderPage> {
  const url = new URL(PATH, source.origin);
  url.searchParams.set('after', String(after));
  url.searchParams.set('limit', String(PAGE_SIZE));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signed = `cloud-mail-inbox-headers-v1\nGET\n${url.pathname}${url.search}\n${timestamp}`;
  const signature = createHmac('sha256', Buffer.from(source.key, 'hex')).update(signed).digest('hex');
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json', 'X-Inbox-Timestamp': timestamp, 'X-Inbox-Signature': signature },
    });
  } catch { throw new Error('收件头服务连接失败'); }
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json' || !response.body) {
    await response.body?.cancel();
    throw new Error('收件头服务未返回成功的 JSON');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let body: unknown;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > RESPONSE_BYTES) { await reader.cancel(); throw new Error(); }
      chunks.push(part.value);
    }
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw new Error('收件头服务响应无效或超出大小限制'); }
  finally { reader.releaseLock(); }
  return parseMailHeaderPage(body, source, after);
}
