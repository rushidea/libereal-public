import { getSupportEmail } from '@/data/serviceEmails';

export type BrandedMailContent = {
  preheader?: string;
  headline: string;
  greeting?: string;
  paragraphs: string[];
  cta?: { label: string; href: string };
  callout?: string;
  disclaimer?: string;
};

const BRAND = {
  name: 'LIBEREAL',
  tagline: '您可靠的科研伙伴',
  logoPath: '/brand-logo-email.png',
  emerald: '#10b981',
  emeraldDark: '#059669',
  slate900: '#0f172a',
  slate800: '#1e293b',
  slate600: '#475569',
  slate500: '#64748b',
  slate100: '#f1f5f9',
  white: '#ffffff',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphHtml(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:${BRAND.slate600};">${escapeHtml(text)}</p>`;
}

export function renderBrandedMailHtml(content: BrandedMailContent, siteUrl: string): string {
  const safeSiteUrl = escapeHtml(siteUrl.replace(/\/$/, ''));
  const logoUrl = escapeHtml(`${siteUrl.replace(/\/$/, '')}${BRAND.logoPath}`);
  const supportEmail = escapeHtml(getSupportEmail());
  const preheader = content.preheader ?? content.paragraphs[0] ?? content.headline;
  const greeting = content.greeting
    ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.7;color:${BRAND.slate600};">${escapeHtml(content.greeting)}</p>`
    : '';
  const body = content.paragraphs.map(paragraphHtml).join('');
  const callout = content.callout
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;">
        <tr>
          <td style="padding:14px 16px;background:${BRAND.slate100};border-left:3px solid ${BRAND.emerald};border-radius:0 8px 8px 0;font-size:14px;line-height:1.6;color:${BRAND.slate600};">
            ${escapeHtml(content.callout)}
          </td>
        </tr>
      </table>`
    : '';
  const cta = content.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;border-collapse:collapse;">
        <tr>
          <td align="center" style="border-radius:8px;background:linear-gradient(135deg,${BRAND.emerald} 0%,${BRAND.emeraldDark} 100%);">
            <a href="${escapeHtml(content.cta.href)}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:${BRAND.white};text-decoration:none;letter-spacing:0.02em;">
              ${escapeHtml(content.cta.label)}
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px;font-size:12px;line-height:1.6;color:${BRAND.slate500};word-break:break-all;">
        若按钮无法打开，请复制链接至浏览器：<br />
        <a href="${escapeHtml(content.cta.href)}" style="color:${BRAND.emeraldDark};text-decoration:none;">${escapeHtml(content.cta.href)}</a>
      </p>`
    : '';
  const disclaimer = content.disclaimer
    ? `<p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #e2e8f0;font-size:13px;line-height:1.6;color:${BRAND.slate500};">${escapeHtml(content.disclaimer)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(content.headline)}</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border-collapse:collapse;">
          <tr>
            <td style="padding:28px 32px 24px;background:linear-gradient(145deg,${BRAND.slate900} 0%,${BRAND.slate800} 100%);border-radius:12px 12px 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td>
                    <div style="font-size:22px;font-weight:700;letter-spacing:0.12em;color:${BRAND.white};text-transform:uppercase;">
                      ${BRAND.name}
                    </div>
                    <div style="margin-top:8px;font-size:13px;letter-spacing:0.08em;color:${BRAND.emerald};">
                      ${BRAND.tagline}
                    </div>
                  </td>
                  <td align="right" valign="middle" style="width:52px;">
                    <img
                      src="${logoUrl}"
                      alt="${BRAND.name}"
                      width="40"
                      height="50"
                      style="display:block;width:40px;height:50px;object-fit:contain;"
                    />
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 32px;background:${BRAND.white};border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
              <h1 style="margin:0 0 20px;font-size:22px;font-weight:600;line-height:1.35;color:${BRAND.slate900};">
                ${escapeHtml(content.headline)}
              </h1>
              ${greeting}
              ${body}
              ${callout}
              ${cta}
              ${disclaimer}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px;background:${BRAND.slate900};border-radius:0 0 12px 12px;border:1px solid ${BRAND.slate800};">
              <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#94a3b8;text-align:center;">
                科研服务平台
              </p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;text-align:center;">
                <a href="${safeSiteUrl}" style="color:${BRAND.emerald};text-decoration:none;">${safeSiteUrl.replace(/^https?:\/\//, '')}</a>
                &nbsp;·&nbsp;
                <a href="mailto:${supportEmail}" style="color:#94a3b8;text-decoration:none;">${supportEmail}</a>
              </p>
              <p style="margin:16px 0 0;font-size:11px;line-height:1.5;color:#475569;text-align:center;">
                此邮件由 ${BRAND.name} 系统自动发送，请勿直接回复。
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderBrandedMailText(content: BrandedMailContent, siteUrl: string): string {
  const lines = [
    `${BRAND.name} · ${BRAND.tagline}`,
    '',
    content.headline,
    '—'.repeat(Math.min(content.headline.length, 24)),
    '',
  ];

  if (content.greeting) {
    lines.push(content.greeting, '');
  }

  lines.push(...content.paragraphs.map((p) => `${p}\n`));

  if (content.callout) {
    lines.push(content.callout, '');
  }

  if (content.cta) {
    lines.push(`${content.cta.label}：${content.cta.href}`, '');
  }

  if (content.disclaimer) {
    lines.push(content.disclaimer, '');
  }

  lines.push(
    siteUrl.replace(/\/$/, ''),
    getSupportEmail(),
    '',
    '此邮件由 LIBEREAL 系统自动发送，请勿直接回复。',
  );

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function buildPasswordResetMail(resetUrl: string, siteUrl: string): { html: string; text: string } {
  const content: BrandedMailContent = {
    preheader: '请在 24 小时内完成密码重置，保障账户安全。',
    headline: '重置您的账户密码',
    greeting: '您好，',
    paragraphs: [
      '我们收到了您的密码重置请求。为保障账户安全，请点击下方按钮设置新密码。',
      '该链接将在 24 小时后失效，请尽快完成操作。',
    ],
    cta: { label: '设置新密码', href: resetUrl },
    disclaimer: '若您未发起此请求，请忽略本邮件，您的密码将保持不变。',
  };

  return {
    html: renderBrandedMailHtml(content, siteUrl),
    text: renderBrandedMailText(content, siteUrl),
  };
}

export function buildNotificationMail(options: {
  headline: string;
  message: string;
  detailUrl: string;
  preheader?: string;
  ctaLabel?: string;
  callout?: string;
}, siteUrl: string): { html: string; text: string } {
  const content: BrandedMailContent = {
    preheader: options.preheader ?? options.message,
    headline: options.headline,
    greeting: '您好，',
    paragraphs: [options.message],
    callout: options.callout,
    cta: { label: options.ctaLabel ?? '查看详情', href: options.detailUrl },
  };

  return {
    html: renderBrandedMailHtml(content, siteUrl),
    text: renderBrandedMailText(content, siteUrl),
  };
}
