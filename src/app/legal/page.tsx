import type { Metadata } from 'next';
import SiteFooter from '@/components/SiteFooter';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { LegalDocumentDownloads } from '@/components/legal/LegalConsentChecklist';
import { listLegalDocuments } from '@/lib/legal-documents';
import { canonicalSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: '法律声明',
  description: 'LIBEREAL 网站法律声明，包含公司信息、知识产权声明及免责声明。',
  alternates: {
    canonical: canonicalSiteUrl('/legal'),
  },
};

export const dynamic = 'force-dynamic';

export default async function LegalPage() {
  const documents = await listLegalDocuments('legal');
  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-10">
        <div className="flex items-center gap-4 mb-2">
          <Link href="/" className="text-sm text-gray-400 hover:text-brand-600 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> 返回首页
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">法律声明</h1>
        <p className="text-sm text-gray-400 mb-8">更新日期:2026年7月17日</p>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6">

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">一、公司信息</h2>
            <div className="bg-gray-50 rounded-xl p-5 space-y-2 text-sm text-gray-600">
              <p><strong>公司名称:</strong>南京天放生物科技有限公司</p>
              <p><strong>统一社会信用代码:</strong>91320114339293690A</p>
              <p><strong>地址:</strong>南京市雨花台区西善桥南路108号</p>
              <p><strong>电子邮件:</strong>legal@libereal.cn</p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">二、ICP 备案信息</h2>
            <div className="bg-gray-50 rounded-xl p-5 space-y-2 text-sm text-gray-600">
              <p><strong>ICP备案号:</strong>苏ICP备2026025232号</p>
              <p><strong>公安机关备案号:</strong>苏公网安备32011402012523号</p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">三、免责声明</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>本站产品信息来源于供应商及公开资料,并采取合理措施维护准确性和时效性。发现错误后将及时更正,具体交易内容以有效订单、报价确认或书面协议为准。</li>
              <li>产品价格、库存和预计货期会随市场及厂家供货情况变化。合同成立前可更新相关信息,合同成立后依订单快照和有效约定履行。</li>
              <li>实验方法和产品资料用于科研参考,不能替代专业判断。因依赖一般性资料产生的损失,根据资料性质、双方过错、因果关系和适用法律确定责任。</li>
              <li>产品使用前应阅读原厂说明书并遵守储存和操作要求。因使用或储存不当造成的损失,由相应责任方承担;产品质量及法律规定不得免除的责任除外。</li>
              <li>本站部分内容可能存在翻译或编辑误差,以原厂英文资料为准。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">四、知识产权保护</h2>
            <div className="bg-gray-50 rounded-xl p-5 space-y-3 text-sm text-gray-600">
              <p><strong>商标声明：</strong>&quot;LIBEREAL&quot;及相关图形、标识均为南京天放生物科技有限公司的注册商标，受中华人民共和国商标法保护。未经本公司书面授权，任何单位和个人不得擅自使用。</p>
              <p><strong>Logo 图形声明：</strong>本网站使用的绿色渐变树叶图形为本公司专有视觉标识，受中华人民共和国著作权法及相关知识产权法律保护。未经本公司书面许可，任何人不得复制、修改、传播或以其他方式使用该图形。</p>
              <p><strong>侵权责任：</strong>任何未经授权擅自使用本公司注册商标或Logo图形的行为，本公司将依法追究其法律责任，包括但不限于停止侵权、消除影响、赔偿损失等。</p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">五、适用法律</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              本网站及本条款受中华人民共和国法律管辖。如发生争议,双方应友好协商解决;协商不成时,提交合同签订地有管辖权的人民法院诉讼解决。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">六、联系我们</h2>
            <p className="text-sm text-gray-600">
              如对本法律声明有任何疑问,请联系:<a href="mailto:legal@libereal.cn" className="text-brand-600 hover:underline">legal@libereal.cn</a>
            </p>
          </section>

          <LegalDocumentDownloads documents={documents} title="商事文书下载" />

        </div>
      </main>

      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
