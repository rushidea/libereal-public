import type { Metadata } from 'next';
import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { Mail, MessageCircle } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import { SERVICE_EMAILS } from '@/data/serviceEmails';
import { canonicalSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: '联系我们',
  description:
    '联系 LIBEREAL 生物试剂采购平台，获取产品咨询、技术支持与商务合作信息。电子邮件 support@libereal.cn，工作日快速响应。',
  alternates: {
    canonical: canonicalSiteUrl('/contact'),
  },
};

export default function ContactPage() {
  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-10">
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">联系我们</h1>
          <p className="text-sm text-gray-500">有任何问题或需求，欢迎随时联系</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-3xl mx-auto">
          {/* Email */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center">
            <div className="bg-brand-50 rounded-xl p-4 w-fit mx-auto mb-4">
              <Mail className="w-6 h-6 text-brand-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">电子邮件</h3>
            <p className="text-sm text-gray-500 mb-3">24 小时内回复</p>
            <p className="text-base font-medium text-brand-600">
              <a href={`mailto:${SERVICE_EMAILS.support}`} className="hover:underline">
                {SERVICE_EMAILS.support}
              </a>
            </p>
            <p className="text-xs text-gray-400 mt-2">
              商务合作：{' '}
              <a href={`mailto:${SERVICE_EMAILS.sales}`} className="text-brand-600 hover:underline">
                {SERVICE_EMAILS.sales}
              </a>
            </p>
          </div>

          {/* WeChat */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center">
            <div className="bg-brand-50 rounded-xl p-4 w-fit mx-auto mb-4">
              <MessageCircle className="w-6 h-6 text-brand-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">微信公众号</h3>
            <p className="text-sm text-gray-500 mb-3">获取最新产品与优惠信息</p>
            <p className="text-base font-medium text-gray-900">搜索：天放生物</p>
          </div>

          {/* Xiaohongshu */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center">
            <div className="bg-brand-50 rounded-xl p-4 w-fit mx-auto mb-4">
              <svg className="w-6 h-6 text-brand-600" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v-2h-2v2zm0-4h2V7h-2v6z"/>
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">小红书</h3>
            <p className="text-sm text-gray-500 mb-3">实验技巧与产品使用分享</p>
            <p className="text-base font-medium text-gray-900">搜索：天放生物试剂</p>
          </div>
        </div>

        <div className="mt-8 bg-gradient-to-r from-brand-50 to-brand-50 rounded-2xl p-6 border border-brand-100 max-w-3xl mx-auto text-center">
          <p className="text-sm text-gray-600 leading-relaxed">
            如需紧急联系或大额询价，请发送邮件至{' '}
            <a href={`mailto:${SERVICE_EMAILS.support}`} className="text-brand-600 hover:underline">
              {SERVICE_EMAILS.support}
            </a>
            。<br />
            我们重视每一位客户的反馈，期待与您合作。
          </p>
        </div>
      </main>

      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}
