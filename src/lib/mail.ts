import { buildNotificationMail, buildPasswordResetMail } from '@/lib/mail-templates';
import fs from 'node:fs';

type EmailProviderName = 'console' | 'resend' | 'http' | 'smtp' | 'directmail' | 'disabled';

export type MailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  from?: string;
  replyTo?: string;
};

export type MailResult = {
  ok: boolean;
  provider: EmailProviderName;
  skipped?: boolean;
  error?: string;
  providerMessageId?: string;
  deliveryState?: 'accepted' | 'rejected' | 'unknown' | 'not_sent';
};

type MailConfig = {
  provider: EmailProviderName;
  from: string;
  replyTo?: string;
  resendApiKey?: string;
  httpEndpoint?: string;
  httpBearerToken?: string;
};

const DEFAULT_DEV_FROM = 'LIBEREAL <no-reply@libereal.local>';
const DEFAULT_RESEND_FROM = 'LIBEREAL <no-reply@libereal.cn>';
const LEGACY_RESEND_FROM_DOMAIN_PATTERN = /@mail\.libereal\.cn(?=>|\b)/gi;
const RESEND_FROM_DOMAIN = '@libereal.cn';

function normalizeProvider(value: string | undefined): EmailProviderName {
  const provider = value?.trim().toLowerCase();
  if (provider === 'resend' || provider === 'http' || provider === 'smtp' || provider === 'directmail' || provider === 'disabled' || provider === 'console') {
    return provider;
  }
  return process.env.NODE_ENV === 'production' ? 'disabled' : 'console';
}

function getMailConfig(): MailConfig {
  const provider = normalizeProvider(process.env.EMAIL_PROVIDER);
  return {
    provider,
    from: normalizeFromAddress(provider, process.env.EMAIL_FROM),
    replyTo: process.env.EMAIL_REPLY_TO?.trim() || undefined,
    resendApiKey: process.env.RESEND_API_KEY?.trim() || undefined,
    httpEndpoint: process.env.EMAIL_HTTP_ENDPOINT?.trim() || undefined,
    httpBearerToken: process.env.EMAIL_HTTP_BEARER_TOKEN?.trim() || undefined,
  };
}

function normalizeFromAddress(provider: EmailProviderName, value: string | undefined): string {
  const fallback = provider === 'resend' ? DEFAULT_RESEND_FROM : DEFAULT_DEV_FROM;
  const from = value?.trim() || fallback;

  if (provider !== 'resend') {
    return from;
  }

  return from.replace(LEGACY_RESEND_FROM_DOMAIN_PATTERN, RESEND_FROM_DOMAIN);
}

function recipients(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to];
}

function publicSiteUrl(): string {
  return (
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

async function sendViaResend(message: MailMessage, config: MailConfig, idempotencyKey?: string): Promise<MailResult> {
  if (!config.resendApiKey) {
    return { ok: false, provider: 'resend', skipped: true, error: 'RESEND_API_KEY is not configured' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    ...(idempotencyKey ? { redirect: 'error' as const, signal: AbortSignal.timeout(25000) } : {}),
    body: JSON.stringify({
      from: message.from || config.from,
      to: recipients(message.to),
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo || config.replyTo
        ? { reply_to: message.replyTo || config.replyTo }
        : {}),
    }),
  });

  if (!response.ok) {
    if (idempotencyKey) return { ok: false, provider: 'resend',
      deliveryState: response.status >= 500 || response.status === 408 || response.status === 409 ? 'unknown' : 'rejected',
      error: `Resend returned ${response.status}` };
    const detail = await response.text().catch(() => '');
    return { ok: false, provider: 'resend', error: `Resend returned ${response.status}${detail ? `: ${detail}` : ''}` };
  }

  if (idempotencyKey) {
    const receipt = await response.json().catch(() => null);
    if (typeof receipt?.id !== 'string' || !receipt.id) return { ok: false, provider: 'resend', deliveryState: 'unknown', error: 'Missing provider receipt' };
    return { ok: true, provider: 'resend', deliveryState: 'accepted', providerMessageId: receipt.id };
  }
  return { ok: true, provider: 'resend' };
}

/** Separate business credentials; never fall back to notification credentials or console delivery. */
function businessMailKey(): string | undefined {
  if (process.env.BUSINESS_MAIL_CREDENTIAL_FILE) {
    const fd = fs.openSync(process.env.BUSINESS_MAIL_CREDENTIAL_FILE, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      const owner = typeof process.getuid === 'function' ? process.getuid() : -1;
      const privateMode = (stat.mode & 0o077) === 0;
      const systemdMode = stat.uid === 0 && stat.gid === 0 && (stat.mode & 0o7777) === 0o440;
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16384 || ![0, owner].includes(stat.uid) || !(privateMode || systemdMode)) throw new Error('Invalid business credential');
      const data = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (data.EMAIL_PROVIDER !== 'resend' || typeof data.RESEND_API_KEY !== 'string') throw new Error('Invalid business credential');
      return data.RESEND_API_KEY.trim() || undefined;
    } finally { fs.closeSync(fd); }
  }
  return process.env.BUSINESS_MAIL_RESEND_API_KEY?.trim() || undefined;
}

export function businessMailAvailable(): boolean {
  try { return process.env.BUSINESS_MAIL_ENABLED === 'true' && Boolean(businessMailKey()); }
  catch { return false; }
}

export async function sendBusinessMailNow(message: MailMessage, idempotencyKey: string): Promise<MailResult> {
  let key: string | undefined;
  try { key = businessMailKey(); } catch { /* A credential error must not expose its content or path. */ }
  if (process.env.BUSINESS_MAIL_ENABLED !== 'true' || !key) {
    return { ok: false, provider: 'resend', skipped: true, deliveryState: 'not_sent', error: '商务发信尚未启用' };
  }
  const allowed = process.env.BUSINESS_MAIL_ALLOWED_RECIPIENTS?.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  if (allowed?.length && recipients(message.to).some(to => !allowed.includes(to.toLowerCase()))) {
    return { ok: false, provider: 'resend', skipped: true, deliveryState: 'not_sent', error: '该收件人不在当前环境获准的发信范围内' };
  }
  if (!/^business-letter-[a-f0-9]{64}$/.test(idempotencyKey)) throw new Error('Invalid business message identity');
  try {
    return await sendViaResend(message, { provider: 'resend', from: message.from!, replyTo: message.replyTo, resendApiKey: key }, idempotencyKey);
  } catch {
    // A timeout does not establish rejection. The persisted claim prevents automatic retry.
    return { ok: false, provider: 'resend', deliveryState: 'unknown', error: '发送结果未知，请核对服务商记录，勿重复发送' };
  }
}

async function sendViaHttp(message: MailMessage, config: MailConfig): Promise<MailResult> {
  if (!config.httpEndpoint) {
    return { ok: false, provider: 'http', skipped: true, error: 'EMAIL_HTTP_ENDPOINT is not configured' };
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.httpBearerToken) {
    headers.Authorization = `Bearer ${config.httpBearerToken}`;
  }

  const response = await fetch(config.httpEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: message.from || config.from,
      to: recipients(message.to),
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: message.replyTo || config.replyTo,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, provider: 'http', error: `HTTP mail provider returned ${response.status}${detail ? `: ${detail}` : ''}` };
  }

  return { ok: true, provider: 'http' };
}

function sendViaConsole(message: MailMessage, config: MailConfig): MailResult {
  console.info('[mail:console]', {
    from: message.from || config.from,
    to: recipients(message.to),
    subject: message.subject,
    replyTo: message.replyTo || config.replyTo,
    text: message.text,
    html: message.html,
  });
  return { ok: true, provider: 'console' };
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  const config = getMailConfig();

  try {
    switch (config.provider) {
      case 'console':
        return sendViaConsole(message, config);
      case 'resend':
        return sendViaResend(message, config);
      case 'http':
        return sendViaHttp(message, config);
      case 'smtp':
      case 'directmail':
        return {
          ok: false,
          provider: config.provider,
          skipped: true,
          error: `${config.provider} provider is reserved; configure EMAIL_PROVIDER=resend or EMAIL_PROVIDER=http for live sending`,
        };
      case 'disabled':
        return { ok: true, provider: 'disabled', skipped: true };
    }
  } catch (error) {
    return {
      ok: false,
      provider: config.provider,
      error: error instanceof Error ? error.message : 'Unknown mail error',
    };
  }
}

export function sendMailInBackground(message: MailMessage, context: string): void {
  void sendMail(message).then((result) => {
    if (!result.ok) {
      console.warn(`[mail:${context}] send failed`, result);
    }
  }).catch((error) => {
    console.error(`[mail:${context}] unexpected error`, error);
  });
}

export async function sendPasswordResetEmail(to: string, resetToken: string): Promise<MailResult> {
  const siteUrl = publicSiteUrl();
  const resetUrl = `${siteUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
  const { html, text } = buildPasswordResetMail(resetUrl, siteUrl);
  return sendMail({
    to,
    subject: 'LIBEREAL · 密码重置',
    text,
    html,
  });
}

export function sendQuoteNotificationEmail(options: {
  to: string;
  subject: string;
  message: string;
  path: string;
  headline?: string;
  callout?: string;
}): void {
  void sendQuoteNotificationEmailNow(options).then((result) => {
    if (!result.ok) console.warn('[mail:quote-notification] send failed', result);
  }).catch((error) => console.error('[mail:quote-notification] unexpected error', error));
}

export async function sendQuoteNotificationEmailNow(options: {
  to: string;
  subject: string;
  message: string;
  path: string;
  headline?: string;
  callout?: string;
}): Promise<MailResult> {
  const siteUrl = publicSiteUrl();
  const detailUrl = `${siteUrl}${options.path}`;
  const headline = options.headline ?? options.subject.replace(/^LIBEREAL\s*[·•-]?\s*/i, '').trim();
  const { html, text } = buildNotificationMail({
    headline,
    message: options.message,
    detailUrl,
    preheader: options.message,
    ctaLabel: '查看详情',
    callout: options.callout,
  }, siteUrl);
  return sendMail({
    to: options.to,
    subject: options.subject,
    text,
    html,
  });
}

export function sendAdminOperationalEmail(options: {
  subject: string;
  message: string;
  path: string;
  headline?: string;
  callout?: string;
}): void {
  const adminRecipients = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);

  if (adminRecipients.length === 0) {
    return;
  }

  const siteUrl = publicSiteUrl();
  const detailUrl = `${siteUrl}${options.path}`;
  const headline = options.headline ?? options.subject.replace(/^LIBEREAL\s*[·•-]?\s*/i, '').trim();
  const { html, text } = buildNotificationMail({
    headline,
    message: options.message,
    detailUrl,
    preheader: options.message,
    ctaLabel: '进入管理后台',
    callout: options.callout,
  }, siteUrl);
  sendMailInBackground({
    to: adminRecipients,
    subject: options.subject,
    text,
    html,
  }, 'admin-operational');
}

export function sendOrganizationNotificationEmail(options: {
  to: string;
  subject: string;
  message: string;
  path: string;
}): void {
  const siteUrl = publicSiteUrl();
  const detailUrl = `${siteUrl}${options.path}`;
  const { html, text } = buildNotificationMail({
    headline: options.subject.replace(/^LIBEREAL\s*[·•-]?\s*/i, '').trim(),
    message: options.message,
    detailUrl,
    preheader: options.message,
    ctaLabel: '查看组织审批',
  }, siteUrl);
  sendMailInBackground({
    to: options.to,
    subject: options.subject,
    text,
    html,
  }, 'organization-notification');
}
