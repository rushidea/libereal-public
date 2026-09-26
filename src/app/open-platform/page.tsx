import SiteFooter from '@/components/SiteFooter';
import OpenPlatformLegalDownloads from '@/components/legal/OpenPlatformLegalDownloads';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { ClipboardCheck, Plug, Truck, Award, Mail, Zap, Shield, Users, Package } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';

export default function OpenPlatformPage() {
  return (
    <div className="min-h-screen flex flex-col libereal-service-page">
      <AdaptiveHeader showNav={true} />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 pb-10">
        {/* Hero Section */}
        <section className="relative py-12 sm:py-16 mb-8">
          {/* Decorative blur orbs */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute -top-24 -right-24 w-96 h-96 bg-brand-200/20 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-purple-200/20 rounded-full blur-3xl" />
          </div>

          <div className="relative text-center">
            <h1 className="text-2xl font-bold text-gray-900 leading-relaxed mb-4">
              面向试剂厂家/品牌方/授权供应商的直供入驻平台
            </h1>
            <p className="text-gray-500 text-sm sm:text-base">
              支持产品数据上架、库存/价格信息同步、询价履约协同，携手优质供应伙伴共建高质量生物试剂供应链。
            </p>
          </div>
        </section>

        {/* Section 1: 厂家直供 */}
        <section className="mb-6">
          <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-3xl p-6 sm:p-8 shadow-xl shadow-black/5">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-orange-200/50">
                <Truck size={26} className="text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">厂家直供与品牌入驻</h2>
                <p className="text-sm text-gray-500">源头合作，规范上架</p>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { icon: Zap, title: '直连供货', desc: '面向试剂厂家、品牌方与授权供应商建立直接供货合作' },
                { icon: Shield, title: '资质核验', desc: '入驻前核验企业、品牌授权、生产或经营资质等材料' },
                { icon: Package, title: '规范上架', desc: '协助整理产品目录、规格型号、包装单位与图文资料' },
                { icon: Award, title: '国产品牌支持', desc: '欢迎国产与初创品牌入驻，完善品类覆盖与供应能力' },
              ].map((item, i) => (
                <div key={i} className="bg-gradient-to-br from-gray-50/80 to-white/60 backdrop-blur-sm rounded-2xl p-5 border border-white/60 hover:shadow-lg transition-shadow">
                  <div className="w-10 h-10 bg-amber-100/70 backdrop-blur-sm rounded-xl flex items-center justify-center mb-3">
                    <item.icon size={20} className="text-amber-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">{item.title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section 2: 数据对接 */}
        <section className="mb-6">
          <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-3xl p-6 sm:p-8 shadow-xl shadow-black/5">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200/50">
                <Plug size={26} className="text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">供应商数据对接</h2>
                <p className="text-sm text-gray-500">按合作方案完成资料上架与信息同步</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { icon: Package, title: '产品目录', desc: '按合作方案对接产品目录、品牌、分类、图片与说明资料' },
                { icon: Shield, title: '规格参数', desc: '同步货号、规格、包装、应用场景、保存条件等关键字段' },
                { icon: Zap, title: '库存与价格', desc: '按约定同步库存状态、供货周期、价格体系与调价信息' },
              ].map((item, i) => (
                <div key={i} className="bg-gradient-to-br from-blue-50/60 to-white/60 backdrop-blur-sm rounded-2xl p-5 border border-white/60 hover:shadow-lg transition-shadow">
                  <div className="w-10 h-10 bg-blue-100/70 backdrop-blur-sm rounded-xl flex items-center justify-center mb-3">
                    <item.icon size={20} className="text-blue-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">{item.title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section 3: 合作履约 */}
        <section className="mb-6">
          <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-3xl p-6 sm:p-8 shadow-xl shadow-black/5">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-200/50">
                <ClipboardCheck size={26} className="text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">询价履约协同</h2>
                <p className="text-sm text-gray-500">围绕报价、交期与售后形成稳定协作</p>
              </div>
            </div>

            <p className="text-sm text-gray-600 leading-relaxed mb-4">
              入驻后，平台将根据合作品类与供货方式建立协同流程，帮助供应商更高效地处理询价、报价、交期确认、发货跟踪与售后支持。
            </p>

            <div className="flex flex-wrap gap-2">
              <span className="text-xs bg-purple-100/70 backdrop-blur-sm text-purple-700 px-3 py-1.5 rounded-full border border-purple-200/50">询价响应</span>
              <span className="text-xs bg-purple-100/70 backdrop-blur-sm text-purple-700 px-3 py-1.5 rounded-full border border-purple-200/50">报价确认</span>
              <span className="text-xs bg-purple-100/70 backdrop-blur-sm text-purple-700 px-3 py-1.5 rounded-full border border-purple-200/50">交期同步</span>
              <span className="text-xs bg-purple-100/70 backdrop-blur-sm text-purple-700 px-3 py-1.5 rounded-full border border-purple-200/50">售后协同</span>
            </div>
          </div>
        </section>

        {/* Section 4: 入驻支持 */}
        <section className="mb-8">
          <div className="bg-white/70 backdrop-blur-md border border-white/70 rounded-3xl p-6 sm:p-8 shadow-xl shadow-black/5">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-green-500 rounded-2xl flex items-center justify-center shadow-lg shadow-green-200/50">
                <Award size={26} className="text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">入驻支持</h2>
                <p className="text-sm text-gray-500">从资料准备到持续运营协同推进</p>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { icon: Users, title: '入驻沟通', desc: '确认合作主体、授权范围、供货品类与基础结算方式' },
                { icon: Package, title: '目录整理', desc: '协助梳理产品资料，提升上架效率与信息完整度' },
                { icon: Shield, title: '资质归档', desc: '沉淀授权、经营许可、质检或合规资料，便于后续履约' },
                { icon: Zap, title: '持续运营', desc: '围绕新品、价格、库存与交期变化保持定期同步' },
              ].map((item, i) => (
                <div key={i} className="bg-gradient-to-br from-green-50/60 to-white/60 backdrop-blur-sm rounded-2xl p-5 border border-white/60 hover:shadow-lg transition-shadow">
                  <div className="w-10 h-10 bg-green-100/70 backdrop-blur-sm rounded-xl flex items-center justify-center mb-3">
                    <item.icon size={20} className="text-green-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">{item.title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <OpenPlatformLegalDownloads />

        {/* Contact Section */}
        <section>
          <div className="bg-gradient-to-br from-brand-600 to-emerald-600 rounded-3xl p-8 text-white shadow-xl shadow-brand-200/20">
            <h2 className="text-xl font-bold mb-4">申请厂家入驻 / 发送合作邮件</h2>
            <p className="text-brand-100 text-sm mb-6">
              请将公司简介、产品目录、品牌授权或相关资质文件发送至 sales@libereal.cn，商务合作团队将尽快与您沟通入驻与对接方案。
            </p>
            <a href="mailto:sales@libereal.cn" className="inline-flex items-center gap-3 text-sm hover:text-brand-200 transition-colors">
              <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                <Mail size={18} />
              </div>
              <span>sales@libereal.cn</span>
            </a>
          </div>
        </section>
      </main>

      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}