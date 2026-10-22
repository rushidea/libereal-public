import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import SiteFooter from '@/components/SiteFooter';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { SERVICE_EMAILS } from '@/data/serviceEmails';
import { SITE_LEGAL_NAME } from '@/lib/seo/site-identity';
import { canonicalSiteUrl } from '@/lib/site-url';

const APP_URL = 'https://mail.libereal.cn';
const INFO_EMAIL = 'info@libereal.cn';
const DESCRIPTION = 'LIBEREAL MAIL 是 Libereal 内部使用的邮件管理系统，由南京天放生物科技有限公司运营。Google 登录只用于核验身份。';

export const metadata: Metadata = {
  title: 'LIBEREAL MAIL',
  description: DESCRIPTION,
  alternates: {
    canonical: canonicalSiteUrl('/mail'),
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    title: 'LIBEREAL MAIL',
    description: DESCRIPTION,
    url: canonicalSiteUrl('/mail'),
  },
};

export default function MailBrandPage() {
  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-10">
        <div className="flex items-center gap-4 mb-2">
          <Link href="/" className="text-sm text-gray-400 hover:text-brand-600 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> 返回首页
          </Link>
        </div>
        <div className="mb-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <Image
            src="/brand/libereal-mail-logo.svg"
            alt="LIBEREAL"
            width={120}
            height={120}
            priority
          />
          <h1 className="text-2xl font-bold text-gray-900">LIBEREAL MAIL</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-8">
          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">应用说明</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              LIBEREAL MAIL 是 Libereal 内部使用的邮件管理系统，由{SITE_LEGAL_NAME}运营。本页无需登录即可阅读，用于说明该应用的用途，以及 Google 登录会访问哪些数据。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">Google 登录</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              Google 登录只用于核验用户身份。访问的数据为姓名、电子邮件地址和 Google 账号标识，对应 openid、email、profile 范围。
            </p>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>姓名</li>
              <li>电子邮件地址</li>
              <li>Google 账号标识（openid、email、profile）</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">数据用途</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>上述信息只用于确认登录者身份</li>
              <li>不用于广告</li>
              <li>不共享，也不出售</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">应用与政策</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>
                打开 LIBEREAL MAIL：
                <a href={APP_URL} className="break-all text-brand-600 hover:underline" rel="noopener noreferrer">
                  {APP_URL}
                </a>
              </li>
              <li>
                <Link href="/privacy" className="text-brand-600 hover:underline">隐私政策</Link>
              </li>
              <li>
                <Link href="/terms" className="text-brand-600 hover:underline">网站使用条款</Link>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">联系方式</h2>
            <div className="bg-gray-50 rounded-xl p-5 space-y-2 text-sm text-gray-600">
              <p><strong>公司名称：</strong>{SITE_LEGAL_NAME}</p>
              <p><strong>地址：</strong>南京市雨花台区西善桥南路108号</p>
              <p>
                <strong>邮箱：</strong>
                <a href={`mailto:${INFO_EMAIL}`} className="text-brand-600 hover:underline">{INFO_EMAIL}</a>
              </p>
              <p>
                <strong>支持邮箱：</strong>
                <a href={`mailto:${SERVICE_EMAILS.support}`} className="text-brand-600 hover:underline">{SERVICE_EMAILS.support}</a>
              </p>
              <p>
                <strong>隐私与法律事务：</strong>
                <a href={`mailto:${SERVICE_EMAILS.legal}`} className="text-brand-600 hover:underline">{SERVICE_EMAILS.legal}</a>
              </p>
            </div>
          </section>

          <section lang="en">
            <h2 className="text-lg font-semibold text-gray-800 mb-3">English</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              LIBEREAL MAIL is the email management system used internally by Libereal. It is operated by {SITE_LEGAL_NAME}. Google sign-in is used only to verify user identity.
            </p>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              Data accessed: name, email address, and Google account identifier (openid, email, and profile scopes). This data is not used for advertising and is not shared or sold.
            </p>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>
                App:{' '}
                <a href={APP_URL} className="break-all text-brand-600 hover:underline" rel="noopener noreferrer">{APP_URL}</a>
              </li>
              <li>
                <Link href="/privacy" className="text-brand-600 hover:underline">Privacy Policy</Link>
              </li>
              <li>
                <Link href="/terms" className="text-brand-600 hover:underline">Terms</Link>
              </li>
              <li>
                Contact: {INFO_EMAIL}, {SERVICE_EMAILS.support}, {SERVICE_EMAILS.legal}
              </li>
            </ul>
          </section>
        </div>
      </main>
      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
