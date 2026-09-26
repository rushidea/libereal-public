import type { Metadata } from 'next';
import SiteFooter from '@/components/SiteFooter';
import Link from 'next/link';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { ArrowLeft, Shield, Truck, RefreshCw, Headphones, CheckCircle, Clock, BadgeCheck } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import { canonicalSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: '产品承诺',
  description: 'LIBEREAL 正品保障、发货与售后服务说明。',
  alternates: {
    canonical: canonicalSiteUrl('/promise'),
  },
};

export default function PromisePage() {
  const promises = [
    {
      icon: Shield,
      title: '100% 正品保障',
      color: 'bg-brand-50',
      iconColor: 'text-brand-600',
      points: [
        '所有产品均从原厂或授权代理商采购',
        '附原厂质检报告（CoA）及说明书',
        '批次可追溯，支持真伪查询',
      ],
    },
    {
      icon: BadgeCheck,
      title: '严格的供应商管理',
      color: 'bg-blue-50',
      iconColor: 'text-blue-600',
      points: [
        '定期评估供应商质量表现，不合格者予以淘汰',
        '冷链运输全程温控记录，确保运输条件符合要求',
        '接到质量问题反馈，第一时间协调厂家处理',
      ],
    },
    {
      icon: Truck,
      title: '交期承诺',
      color: 'bg-amber-50',
      iconColor: 'text-amber-600',
      points: [
        '现货产品：付款后 1–3 个工作日发出',
        '期货/定制产品：注明交期，逾期提前通知',
        '加急服务：可付费选择优先处理',
        '大货/批量订单：单独确认交期',
      ],
    },
    {
      icon: RefreshCw,
      title: '换货保障',
      color: 'bg-purple-50',
      iconColor: 'text-purple-600',
      points: [
        '试剂类商品交付后原则上不接受无理由退换',
        '质量问题：核实后免费更换并承担合理运费',
        '发货错误或运输损坏：按售后程序处理',
        '生活消费用途订单依法保留相应退货权利',
      ],
    },
    {
      icon: Headphones,
      title: '专业技术支持',
      color: 'bg-rose-50',
      iconColor: 'text-rose-600',
      points: [
        '实验方案咨询免费',
        '产品使用问题 24 小时内回复',
        '可预约原厂技术人员一对一支持',
        'VIP客户一对一专人对接',
      ],
    },
    {
      icon: Clock,
      title: '客服响应承诺',
      color: 'bg-cyan-50',
      iconColor: 'text-cyan-600',
      points: [
        '工作时间（周一至周五 9:00–18:00）：4 小时内响应',
        '非工作时间：24 小时内回复',
        '紧急订单问题：优先处理',
        '定期回访，了解实验进展',
      ],
    },
  ];

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
          <h1 className="text-2xl font-bold text-gray-900 mb-2">我们的承诺</h1>
          <p className="text-sm text-gray-500">为科研工作者提供可信赖的生物试剂供应服务</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {promises.map(({ icon: Icon, title, color, iconColor, points }) => (
            <div key={title} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className={`${color} rounded-xl p-3`}>
                  <Icon className={`w-6 h-6 ${iconColor}`} />
                </div>
                <h2 className="text-base font-semibold text-gray-900">{title}</h2>
              </div>
              <ul className="space-y-2.5">
                {points.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm text-gray-600">
                    <CheckCircle className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 bg-gradient-to-r from-brand-50 to-brand-50 rounded-2xl p-6 border border-brand-100">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">服务监督</h3>
          <p className="text-sm text-gray-600 leading-relaxed">
            如您对我们的服务不满意，请第一时间联系我们。我们重视每一次反馈，并将持续改进。
            投诉邮箱：<a href="mailto:support@libereal.cn" className="text-brand-600 hover:underline">support@libereal.cn</a>
          </p>
        </div>
      </main>

      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}
