import type { Metadata } from 'next';
import SiteFooter from '@/components/SiteFooter';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { canonicalSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: '隐私政策',
  description: 'LIBEREAL 隐私政策，说明我们如何收集、使用及保护您的个人信息。',
  alternates: {
    canonical: canonicalSiteUrl('/privacy'),
  },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-10">
        <div className="flex items-center gap-4 mb-2">
          <Link href="/" className="text-sm text-gray-400 hover:text-brand-600 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> 返回首页
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">隐私政策</h1>
        <p className="text-sm text-gray-400 mb-8">更新日期：2025年1月1日</p>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-8">

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">一、信息收集</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              当您注册账户、提交询价或下单时，我们可能收集您的以下信息：
            </p>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>姓名、公司名称、职位</li>
              <li>电子邮件地址、电话号码</li>
              <li>收货/实验室地址</li>
              <li>账单信息（仅用于交易处理，不存储完整信用卡信息）</li>
              <li>实验需求、询价产品信息</li>
              <li>IP 地址、浏览器类型、访问时间（服务器日志）</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">二、信息使用</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              我们收集的信息仅用于以下目的：
            </p>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>处理询价、订单及相关客户服务</li>
              <li>发送订单确认、发货通知、技术支持回复</li>
              <li>产品推荐与优惠信息推送（您可随时退订）</li>
              <li>网站功能改进与安全监控</li>
              <li>遵守法律法规要求</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">三、信息保存</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>账户信息：保留至您注销账户后 24 个月</li>
              <li>订单记录：保留至少 3 年（税务合规要求）</li>
              <li>通信记录：保留 12 个月</li>
              <li>服务器日志：保留 30 天</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">四、信息共享</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              未经您同意，我们不会向第三方出售或出租您的个人信息。以下情况除外：
            </p>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>向供应商/分销商转发询价，以完成产品采购</li>
              <li>向物流合作方提供收货信息</li>
              <li>支付网关处理交易（符合 PCI DSS 标准）</li>
              <li>法律法规要求（公安、法院、监管机构）</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">五、信息保护</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>全站 HTTPS 加密传输</li>
              <li>账户密码 bcrypt 加密存储</li>
              <li>数据库访问权限严格管控</li>
              <li>定期安全漏洞扫描与修复</li>
              <li>员工访问日志审计</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">六、您的权利</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              根据《个人信息保护法》，您享有以下权利：
            </p>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li><strong>知情权：</strong>了解我们如何收集、使用您的信息</li>
              <li><strong>访问权：</strong>登录账户查看您的个人信息</li>
              <li><strong>更正权：</strong>更正不准确的个人信息</li>
              <li><strong>删除权：</strong>要求删除您的账户及相关数据</li>
              <li><strong>撤回同意：</strong>随时撤回Cookie授权（见下方说明）</li>
              <li><strong>投诉权：</strong>向有关监管机构投诉</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">七、Cookie 政策</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              我们使用 Cookie 和类似技术来改善用户体验：
            </p>
            <div className="space-y-2">
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-700 mb-1">必要 Cookie</p>
                <p className="text-xs text-gray-500">用于维持登录状态、购物车功能、 session 安全。不可关闭。</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-700 mb-1">功能 Cookie</p>
                <p className="text-xs text-gray-500">记住语言偏好、显示设置。您可通过浏览器设置关闭。</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-700 mb-1">分析 Cookie</p>
                <p className="text-xs text-gray-500">帮助我们了解访客行为以改进网站。也可通过浏览器关闭。</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">八、未成年人信息</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              我们不向 18 岁以下未成年人提供服务，也不故意收集其个人信息。如家长或监护人发现未成年人注册了账户，请联系我们（legal@libereal.cn）予以删除。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">九、政策更新</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              我们可能不时更新本隐私政策。重大变更将在网站显著位置发布通知。建议您定期查阅。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">十、联系我们</h2>
            <div className="bg-gray-50 rounded-xl p-5 space-y-2 text-sm text-gray-600">
              <p><strong>公司名称：</strong>南京天放生物科技有限公司</p>
              <p><strong>地址：</strong>南京市雨花台区西善桥南路108号</p>
              <p><strong>电子邮件：</strong>legal@libereal.cn</p>
              <p><strong>ICP备案号：</strong>苏ICP备2026025232号</p>
              <p><strong>公安机关备案号：</strong>苏公网安备32011402012523号</p>
            </div>
          </section>

        </div>
      </main>

      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
