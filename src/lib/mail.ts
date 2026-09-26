import { buildNotificationMail, buildPasswordResetMail } from '@/lib/mail-templates';

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

async function sendViaResend(message: MailMessage, config: MailConfig): Promise<MailResult> {
  if (!config.resendApiKey) {
    return { ok: false, provider: 'resend', skipped: true, error: 'RESEND_API_KEY is not configured' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
    },
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
    const detail = await response.text().catch(() => '');
    return { ok: false, provider: 'resend', error: `Resend returned ${response.status}${detail ? `: ${detail}` : ''}` };
  }

  return { ok: true, provider: 'resend' };
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
