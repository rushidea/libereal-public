"use client";

import SiteFooter from '@/components/SiteFooter';
import Link from 'next/link';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { ArrowLeft, ChevronDown, ChevronUp, Mail, MessageCircle } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import JsonLd from '@/components/JsonLd';
import { helpFaqs } from '@/data/help-faqs';
import { buildFaqPageJsonLd } from '@/lib/seo/json-ld';
import { useState } from 'react';

export default function HelpPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <JsonLd data={buildFaqPageJsonLd(helpFaqs)} />
      <AdaptiveHeader />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-10">
        <div className="flex items-center gap-4 mb-2">
          <Link href="/" className="text-sm text-gray-400 hover:text-brand-600 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> 返回首页
          </Link>
        </div>
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">帮助与支持</h1>
          <p className="text-sm text-gray-500">常见问题与解答，如仍有疑问欢迎联系我们</p>
        </div>

        {/* Contact shortcuts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 max-w-xl mx-auto">
          <Link href="/contact" className="bg-white rounded-2xl border border-gray-100 p-5 text-center hover:shadow-md transition-shadow">
            <div className="bg-brand-50 rounded-xl p-3 w-fit mx-auto mb-3">
              <Mail className="w-5 h-5 text-brand-600" />
            </div>
            <p className="text-sm font-medium text-gray-800">电子邮件</p>
            <p className="text-xs text-gray-400 mt-1">support@libereal.cn</p>
          </Link>
          <Link href="/contact" className="bg-white rounded-2xl border border-gray-100 p-5 text-center hover:shadow-md transition-shadow">
            <div className="bg-brand-50 rounded-xl p-3 w-fit mx-auto mb-3">
              <MessageCircle className="w-5 h-5 text-brand-600" />
            </div>
            <p className="text-sm font-medium text-gray-800">微信咨询</p>
            <p className="text-xs text-gray-400 mt-1">天放生物</p>
          </Link>
        </div>

        {/* Quick links */}
        <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-8">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">快捷链接</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['/faq', '常见问题'],
              ['/promise', '产品承诺'],
              ['/privacy', '隐私政策'],
              ['/terms', '使用条款'],
              ['/about', '关于我们'],
            ].map(([href, label]) => (
              <Link key={href} href={href} className="text-sm text-brand-600 hover:underline text-center py-2 text-xs">
                {label} →
              </Link>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100">
          <h2 className="text-sm font-semibold text-gray-800 px-6 py-4">常见问题</h2>
          {helpFaqs.map(({ q, a }, i) => {
            const open = openIdx === i;
            return (
            <div key={q}>
              <button
                onClick={() => setOpenIdx(open ? null : i)}
                className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
              >
                <span className="text-sm font-medium text-gray-800 pr-4">{q}</span>
                {open
                  ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                }
              </button>
              <div className="px-6 pb-4" hidden={!open}>
                <p className="text-sm text-gray-600 leading-relaxed">{a}</p>
              </div>
            </div>
            );
          })}
        </div>
      </main>

      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}
