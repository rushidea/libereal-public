import { notFound } from 'next/navigation';
import {
  buildNotificationMail,
  buildPasswordResetMail,
} from '@/lib/mail-templates';

function previewSiteUrl(): string {
  return (
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

function buildMailPreviewSamples(siteUrl: string) {
  return [
    {
      id: 'password-reset',
      label: '密码重置',
      subject: 'LIBEREAL · 密码重置',
      ...buildPasswordResetMail(
        `${siteUrl}/reset-password?token=preview-token-example`,
        siteUrl
      ),
    },
    {
      id: 'order-confirm',
      label: '订单确认',
      subject: 'LIBEREAL · 订单确认',
      ...buildNotificationMail(
        {
          headline: '订单确认',
          message: '您的订单已确认，请查看订单详情。',
          detailUrl: `${siteUrl}/account/orders`,
          ctaLabel: '查看详情',
        },
        siteUrl
      ),
    },
    {
      id: 'quote',
      label: '报价通知',
      subject: 'LIBEREAL · 报价通知',
      ...buildNotificationMail(
        {
          headline: '报价通知',
          message: '您的询价单已收到报价，请查看并确认产品。',
          detailUrl: `${siteUrl}/account/inquiries`,
          callout: '询价单 #INQ-20260322-001 · 共 3 款产品',
        },
        siteUrl
      ),
    },
    {
      id: 'admin-order',
      label: '管理员 · 新订单',
      subject: 'LIBEREAL · 新订单',
      ...buildNotificationMail(
        {
          headline: '新订单',
          message: '新订单 ORD-20260322-001，金额 ¥12,800',
          detailUrl: `${siteUrl}/admin/orders`,
          ctaLabel: '进入管理后台',
        },
        siteUrl
      ),
    },
  ] as const;
}

export default function MailPreviewPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  const samples = buildMailPreviewSamples(previewSiteUrl());

  return (
    <main className="min-h-screen bg-slate-100 py-10 px-4">
      <div className="max-w-4xl mx-auto space-y-10">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">邮件模板预览</h1>
          <p className="text-sm text-slate-600">
            模板源码：<code className="text-xs bg-white px-1.5 py-0.5 rounded">src/lib/mail-templates.ts</code>
            {' · '}
            发送逻辑：<code className="text-xs bg-white px-1.5 py-0.5 rounded">src/lib/mail.ts</code>
          </p>
          <p className="text-xs text-slate-500">
            仅开发环境可用。本地运行 <code className="bg-white px-1 rounded">npm run dev</code> 后访问本页。
          </p>
        </header>

        {samples.map((sample) => (
          <section key={sample.id} className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-lg font-medium text-slate-800">{sample.label}</h2>
              <span className="text-sm text-slate-500">{sample.subject}</span>
            </div>
            <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-white">
              <iframe
                title={sample.label}
                srcDoc={sample.html}
                className="w-full min-h-[720px] border-0"
                sandbox=""
              />
            </div>
            <details className="text-sm text-slate-600">
              <summary className="cursor-pointer select-none">纯文本版本</summary>
              <pre className="mt-2 p-4 bg-white rounded-lg border border-slate-200 text-xs whitespace-pre-wrap overflow-x-auto">
                {sample.text}
              </pre>
            </details>
          </section>
        ))}
      </div>
    </main>
  );
}
