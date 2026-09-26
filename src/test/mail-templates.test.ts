import { describe, expect, it } from 'vitest';
import {
  buildNotificationMail,
  buildPasswordResetMail,
  renderBrandedMailHtml,
} from '@/lib/mail-templates';

describe('mail templates', () => {
  const siteUrl = 'https://libereal.cn';

  it('renders password reset with branded layout and CTA', () => {
    const resetUrl = 'https://libereal.cn/reset-password?token=abc123';
    const { html, text } = buildPasswordResetMail(resetUrl, siteUrl);

    expect(html).toContain('LIBEREAL');
    expect(html).toContain('您可靠的科研伙伴');
    expect(html).toContain('设置新密码');
    expect(html).toContain(resetUrl);
    expect(html).toContain('24 小时');
    expect(text).toContain('设置新密码');
    expect(text).toContain(resetUrl);
  });

  it('escapes user-controlled message content', () => {
    const { html } = buildNotificationMail({
      headline: '订单确认',
      message: '<script>alert(1)</script> 您的订单已确认',
      detailUrl: 'https://libereal.cn/account/orders',
    }, siteUrl);

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('includes preheader and footer links', () => {
    const html = renderBrandedMailHtml({
      headline: '测试标题',
      paragraphs: ['正文内容'],
      cta: { label: '立即查看', href: 'https://libereal.cn/test' },
    }, siteUrl);

    expect(html).toContain('display:none');
    expect(html).toContain('brand-logo-email.png');
    expect(html).toContain('support@libereal.cn');
    expect(html).toContain('libereal.cn');
  });
});
