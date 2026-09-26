import type { Metadata } from 'next';
import SiteFooter from '@/components/SiteFooter';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { canonicalSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: '网站使用条款',
  description: 'LIBEREAL 网站使用条款，规范用户访问与使用本平台的行为。',
  alternates: {
    canonical: canonicalSiteUrl('/terms'),
  },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-10">
        <div className="flex items-center gap-4 mb-2">
          <Link href="/" className="text-sm text-gray-400 hover:text-brand-600 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> 返回首页
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">网站使用条款</h1>
        <p className="text-sm text-gray-400 mb-8">更新日期：2026年7月17日</p>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-8">

          <section id="website">
            <h2 className="text-lg font-semibold text-gray-800 mb-3">一、网站使用条款</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-3">
              访问或使用 LIBEREAL 网站（以下简称&quot;本站&quot;），即表示您同意遵守本条款。
            </p>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>您同意仅将本站用于合法目的，不得进行任何违法活动</li>
              <li>账户使用人应妥善保管登录凭证；发现异常使用后应及时通知本站，双方按各自过错和法律规定承担相应责任</li>
              <li>产品价格、库存和预计货期会随市场与厂家供货情况变化；询价信息不构成销售承诺，直接下单交易依本页及《销售条款和条件》确定合同成立时间</li>
              <li>合同成立前，本站可以更新价格、规格和库存；合同成立后的价格与履行内容以订单快照、报价确认或书面协议为准</li>
              <li>产品图片仅供参考，以实际交付为准</li>
              <li>因网络故障或系统维护造成服务中断时，本站将采取合理措施恢复服务；责任承担依故障原因、过错及适用法律确定</li>
            </ul>
          </section>

          <section id="sales">
            <h2 className="text-lg font-semibold text-gray-800 mb-3">二、销售条款和条件</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li><strong>订单确认：</strong>询价在正式报价被接受时成立交易；直接订单在系统确认、收款或双方签署书面文件时成立，以最早发生者为准。未收款且标注“待确认”的回执仅表示收到申请。</li>
              <li><strong>付款条款：</strong>支付宝订单在创建后 24 小时内预付；对公转账、锐竞和喀斯玛订单在授信额度内先交货后付款，默认账期自全部交货之日起 30 天。</li>
              <li><strong>采购方义务：</strong>内部报销、经费审批、发票流转或第三方采购平台处理延迟不改变到期付款义务。对部分货物存在争议时，无争议货款仍应按期支付。</li>
              <li><strong>订单取消：</strong>订单成立并进入采购、备货或定制后，采购方无约定或法定依据拒绝收货或要求取消的，应赔偿有凭证且可预见的合理损失；可回收价值、再次销售所得和避免发生的费用应予扣除。质量问题、错误交付及依法或依约解除的情形除外。</li>
              <li><strong>发票：</strong>我们开具增值税专用发票或普通发票，随货寄出或单独寄送；支持电子发票，发送至客户指定邮箱或实时通讯工具。</li>
              <li><strong>交付：</strong>页面货期为预计时间，确认订单中的交付承诺为履行依据。客观供货变化发生时，本站会及时通知并协商替代、部分履行、延期或解除未履行部分。</li>
              <li><strong>运费：</strong>运费及其他配送费用将在确认订单前显示。</li>
              <li><strong>验收：</strong>收到货物后请于 7 天内验收，如有质量问题或货物件数不符，请立即联系我们。</li>
              <li><strong>退货：</strong>试剂、抗体、定制及需特定温控的产品，按商品性质、下单时的显著提示和适用法律处理；经核实属于产品质量问题或错误交付的，依法提供退换或其他处理。详情见退货政策。</li>
              <li><strong>试剂特殊属性：</strong>机构或生产经营用途采购的试剂，交付后原则上不接受无理由退换。生活消费用途订单依法享有的权利不受影响；拆封后品质易改变或试用后价值明显降低的试剂，须在购买环节显著提示并经单独确认后排除七日无理由退货。</li>
              <li><strong>质保：</strong>产品享有原厂质保期，质保期内质量问题免费更换（需提供实验数据）。</li>
              <li><strong>责任分配：</strong>因使用或保存不当、实验设计或操作原因造成的损失，由相应责任方承担；产品质量、错误交付、故意或重大过失及法律规定不得免除的责任不受本条限制。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">三、知识产权</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              本网站上的所有内容（文字、图片、数据、产品信息）版权归 LIBEREAL 或其供应商所有，未经授权不得复制、转载、传播。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">四、联系我们</h2>
            <div className="bg-gray-50 rounded-xl p-5 space-y-2 text-sm text-gray-600">
              <p><strong>电子邮件：</strong>legal@libereal.cn</p>
            </div>
          </section>

        </div>
      </main>

      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
