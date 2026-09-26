import type { Metadata } from 'next';
import SiteFooter from '@/components/SiteFooter';
import Link from 'next/link';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { ArrowLeft, Target, Users, Heart, Award, Mail } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import { canonicalSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: '关于我们',
  description:
    '了解南京天放生物科技有限公司及 LIBEREAL 生物试剂采购平台，专注为科研工作者提供高品质抗体、ELISA试剂盒及分子生物学产品。',
  alternates: {
    canonical: canonicalSiteUrl('/about'),
  },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-10">
        <div className="flex items-center gap-4 mb-2">
          <Link href="/" className="text-sm text-gray-400 hover:text-brand-600 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> 返回首页
          </Link>
        </div>
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">关于我们</h1>
          <p className="text-sm text-gray-500">南京天放生物科技有限公司</p>
        </div>

        {/* Story */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-brand-500" />
            我们的故事
          </h2>
          <p className="text-sm text-gray-600 leading-relaxed mb-4">
            南京，六朝古都，高校林立。这里活跃着众多生命科学的科研力量，也正是这片人文气息浓厚的土壤，孕育了天放生物——一家专注于为科研工作者提供高品质生物试剂的供应商。
            团队成员深耕生命科学领域多年，深刻理解科研人员对试剂品质、交期和服务的严苛要求。
          </p>
          <p className="text-sm text-gray-600 leading-relaxed">
            可靠的供应商是实验成功的第一道保障。我们只与原厂及授权代理商合作,产品来源可追溯、品质有保证。从抗体到蛋白、从试剂盒到实验室耗材,做好科研人员的后盾。
          </p>
        </div>

        {/* Values */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Heart className="w-5 h-5 text-brand-500" />
            我们的价值观
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {[
              {
                title: '诚信为本',
                desc: '不夸大宣传，如实告知产品来源与质量情况，让客户每一分钱都花得明白。',
              },
              {
                title: '服务至上',
                desc: '快速响应、专业建议、主动跟进，用服务建立信任，用信任赢得长期合作。',
              },
              {
                title: '质量优先',
                desc: '宁可放弃不合格的货源，也不让客户承担实验失败的风险。',
              },
            ].map(({ title, desc }) => (
              <div key={title} className="bg-gray-50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">{title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Team */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 mb-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-500" />
            我们的团队
          </h2>
          <p className="text-sm text-gray-600 leading-relaxed mb-4">
            我们的团队由具有生命科学背景的专业人员组成，核心成员均来自知名科研院所和生物公司。
            我们相信，只有真正懂实验的人，才能提供真正有价值的服务。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="font-medium text-gray-800 mb-1">销售团队</p>
              <p className="text-xs text-gray-500">熟悉各类实验流程，能快速匹配客户需求与产品</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="font-medium text-gray-800 mb-1">技术支持团队</p>
              <p className="text-xs text-gray-500">具有实验经验，可提供方案咨询与问题解答</p>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-brand-500" />
            联系我们
          </h2>
          <div className="space-y-3">
            {[
              { icon: Mail, label: '邮箱', value: 'support@libereal.cn' },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="bg-brand-50 rounded-lg p-2">
                  <Icon className="w-4 h-4 text-brand-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="text-sm text-gray-700">{value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}
