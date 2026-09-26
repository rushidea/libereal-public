import type { Metadata } from 'next';
import SiteFooter from '@/components/SiteFooter';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { canonicalSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: 'Cookie 政策',
  description: 'LIBEREAL Cookie 政策，说明我们如何使用 Cookie 及类似技术。',
  alternates: {
    canonical: canonicalSiteUrl('/cookies'),
  },
};

export default function CookiesPage() {
  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-10">
        <div className="flex items-center gap-4 mb-2">
          <Link href="/" className="text-sm text-gray-400 hover:text-brand-600 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> 返回首页
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Cookie 政策</h1>
        <p className="text-sm text-gray-400 mb-8">更新日期：2025年1月1日</p>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6">
          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">什么是 Cookie？</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              Cookie 是您访问网站时浏览器存储在您设备上的小型文本文件。它们被广泛用于确保网站正常运作、提升用户体验，以及提供网站分析功能。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">我们使用的 Cookie 类型</h2>
            <div className="space-y-3">
              {[
                { name: '必要 Cookie', desc: '维持网站核心功能所必需，包括用户登录状态、购物车、session 安全等。此类 Cookie 无法关闭。', required: true },
                { name: '功能 Cookie', desc: '记住您的偏好设置，如语言选择、显示参数等。可通过浏览器设置关闭。', required: false },
                { name: '分析 Cookie', desc: '帮助我们了解访客如何与网站互动，以便改进用户体验。数据匿名化处理。', required: false },
                { name: '营销 Cookie', desc: '用于展示相关广告。不在中国大陆地区使用。', required: false },
              ].map(c => (
                <div key={c.name} className="bg-gray-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-gray-700">{c.name}</p>
                    {c.required && <span className="text-xs bg-brand-100 text-brand-700 px-2 py-0.5 rounded">不可关闭</span>}
                  </div>
                  <p className="text-xs text-gray-500">{c.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">如何管理 Cookie？</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              您可以在浏览器设置中查看、管理或删除 Cookie：
            </p>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1">
              <li><strong>Chrome：</strong>设置 → 隐私与安全 → Cookie</li>
              <li><strong>Safari：</strong>偏好设置 → 隐私 → Cookie</li>
              <li><strong>Firefox：</strong>选项 → 隐私与安全 → Cookie</li>
            </ul>
            <p className="text-sm text-gray-500 mt-3">
              注意：关闭必要 Cookie 将导致网站部分功能无法正常使用。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">第三方 Cookie</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              部分服务由第三方提供（如 Google Analytics），其 Cookie 由相应第三方管理。我们已要求合作方遵循适用数据保护法律。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">联系我们</h2>
            <p className="text-sm text-gray-600">如对本政策有疑问，请联系：<a href="mailto:legal@libereal.cn" className="text-brand-600 hover:underline">legal@libereal.cn</a></p>
          </section>
        </div>
      </main>

      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
