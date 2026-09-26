import type { Metadata } from 'next';
import SiteFooter from '@/components/SiteFooter';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import { canonicalSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: '销售条款与条件',
  description: 'LIBEREAL 销售条款与条件，规范产品订购、付款、发货及售后服务。',
  alternates: {
    canonical: canonicalSiteUrl('/legal/sales-terms'),
  },
};

export default function SalesTermsPage() {
  return (
    <div className="min-h-screen libereal-service-page flex flex-col">
      <AdaptiveHeader />
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-10">
        <div className="flex items-center gap-4 mb-2">
          <Link href="/" className="text-sm text-gray-400 hover:text-brand-600 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> 返回首页
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">销售条款与条件</h1>
        <p className="text-sm text-gray-400 mb-8">更新日期：2026年7月17日</p>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-8">

          <section className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3">
            <h2 className="text-base font-semibold text-gray-900 mb-2">重要提示</h2>
            <p className="text-sm text-gray-700 leading-relaxed">
              支付宝订单采用先付款后履行，付款期限为订单创建后 24 小时；对公转账、锐竞和喀斯玛订单采用授信额度内先交货后付款，默认账期自全部交货之日起 30 天。订单成立后，采购方无约定或法定依据拒绝收货、取消订单或迟延付款的，应按本条款承担相应违约责任。产品价格、库存和预计货期在合同成立前可能调整；厂家停产、配额调整等客观供货障碍发生时，双方将协商替代、部分履行、延期或解除未履行部分。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">一、公司信息</h2>
            <div className="bg-gray-50 rounded-xl p-5 space-y-2 text-sm text-gray-600">
              <p><strong>公司名称：</strong>南京天放生物科技有限公司</p>
              <p><strong>统一社会信用代码：</strong>91320114339293690A</p>
              <p><strong>地址：</strong>南京市雨花台区西善桥南路108号</p>
              <p><strong>电子邮件：</strong>sales@libereal.cn</p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">二、产品订购</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>产品价格、库存状态和预计货期会随市场、厂家供货及物流情况动态变化。询价商品的页面信息用于采购参考，客户提交询价不代表买卖合同成立。</li>
              <li>询价交易在客户接受正式报价时成立；直接下单交易在系统发出订单确认、我们实际收取价款或双方另行签署书面文件时成立，以最早发生者为准。仅显示“待确认”且尚未收款的自动回执只表示收到采购申请。</li>
              <li>合同成立后，我们会尽合理商业努力完成采购和交付。厂家停产、配额调整、进口限制、库存差异或其他客观供货障碍发生时，我们会及时通知，并与客户协商替代产品、部分履行、延期履行或解除未履行部分。</li>
              <li>已付款订单无法继续履行且未能达成替代安排的，未履行部分款项按原支付方式退还；依法应承担的其他责任依适用法律和双方有效约定处理。</li>
              <li>批量订单或特殊定制产品需另行签订采购合同。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">三、支付条款</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li><strong>支付宝预付：</strong>采购方应在订单创建后 24 小时内完成付款。逾期未付且订单尚未成立或尚未进入履行的，订单可以自动失效或取消，采购方无需支付未发生的货款。</li>
              <li>支付宝付款完成后，订单取消、退货和退款按合同约定、法定解除权及本站售后程序处理。已付款订单不得通过普通状态变更跳过退款审核。</li>
              <li><strong>交货后付款：</strong>对公转账、锐竞和喀斯玛采用授信采购。订单确认时占用授信额度，全部交货后开始计算账期，默认账期为 30 天；订单或书面协议另有约定的，从其约定。</li>
              <li>采购方内部报销、经费审批、发票流转、项目结题、人员变动或第三方采购平台处理延迟，不构成延期付款或拒绝付款的免责事由。</li>
              <li>采购方对部分货物提出质量或数量异议时，应及时说明具体项目并提供合理证据。无争议部分的货款仍应按期支付；争议部分由双方核验后依法处理。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">四、信用额度与账期</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>用户注册后，系统可根据账户资料、历史订单、付款记录和合作情况给予相应信用度及授信额度。</li>
              <li>获得授信额度的账户，可在授信额度内采用对公转账、锐竞或喀斯玛先交货后付款；具体额度、适用产品和账期以系统显示或双方确认结果为准。</li>
              <li>默认账期自订单全部交货之日起 30 天。采购方应在到期日前付清货款，催款通知不延长付款期限。</li>
              <li>逾期付款可能导致信用度下调、授信额度减少或暂停，并可能影响后续订单折扣、促销产品资格及其他优惠政策。</li>
              <li>逾期达到 90 天时，系统可以暂停后续采购和授信；回款完成或管理员依法审核解除后恢复。暂停授信不免除已经到期的付款责任。</li>
              <li>有确切证据证明采购方经营状况严重恶化、转移财产、丧失商业信誉或存在其他可能丧失履约能力的情形时，本站可依法中止尚未履行的订单并及时通知；采购方恢复履约能力或提供适当担保后继续履行。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">五、价格与税费</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>产品价格全部含税，如需开具增值税发票类型请在订单中注明。</li>
              <li>合同成立前，价格可根据市场、厂家报价、汇率、税费及供货条件调整；合同成立后采用订单或报价快照中的价格，双方另有书面约定的除外。</li>
              <li>页面出现明显价格错误、规格错配或系统计算异常时，我们会暂停处理并及时联系客户核实。双方无法就更正内容达成一致的，按适用法律处理并退还未履行部分的已付款项。</li>
              <li>运费、保险费及关税由买方承担（另有约定除外）。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">六、交货与运输</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>页面货期和“现货”状态属于下单时的预计信息；订单确认中明确承诺的交付日期构成履行依据。预计货期发生变化时，我们会及时通知。</li>
              <li>我们按产品特性选择合适的运输方式（常温、冷链、危险品运输等）。</li>
              <li>冷链产品按产品要求和订单约定采取合理温控措施；温度记录以承运服务和订单约定能够提供的范围为准。</li>
              <li>货物损坏或丢失请在收货后 48 小时内提供证据并联系我们。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">七、退换货政策</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li><strong>试剂特殊属性：</strong>生物试剂通常对温度、时效、密封、污染控制及储存连续性有严格要求，退回后往往无法验证储存条件或恢复原始销售状态。机构或生产经营用途采购的试剂，除质量问题、错误交付、运输损坏、双方另有书面约定或法律另有规定外，交付后不接受无理由退换；未拆封仅表示可以提交协商申请，不代表必然符合退换条件。</li>
              <li><strong>生活消费用途的网络订单：</strong>依法适用七日无理由退货的，从其规定。定制、鲜活易腐，以及拆封后易导致品质改变或试用后价值贬损较大的试剂，在购买环节经过显著提示并由消费者单独确认后，不适用七日无理由退货。</li>
              <li>判断试剂能否保持原始销售状态时，可核验原厂密封、包装、标签、批号、有效期、温控记录、储存条件、污染情况及配套资料。仅以“影响二次销售”为由扩大排除法定无理由退货范围的，不适用。</li>
              <li>因质量问题或发货错误导致的退换货，来回运费由我们承担。</li>
              <li>已拆封、已使用、已混合或稀释，以及因采购方储存、运输或操作不当导致品质改变的试剂，不属于非质量原因退换范围；经核实属于交付前质量问题的除外。</li>
              <li>定制、易腐或需特定温控的产品，按商品性质、下单时的显著提示和适用法律处理。</li>
              <li>退货退款将在收到退货并验收合格后 7 个工作日内处理完成。</li>
              <li>订单尚未发货时，采购方可以提交取消申请。订单已部分或全部发货后，质量异议、数量差异和退货退款应通过售后程序处理，不能以整单取消代替验收和结算。</li>
              <li>订单成立后，采购方在没有约定或法定依据的情况下拒绝收货、要求取消，或者明知没有付款安排仍要求本站采购、备货或定制，构成违约的，应赔偿由此造成且能够证明的合理损失。</li>
              <li>可主张的损失可包括无法退回供应商的采购成本、合理退运费、仓储费、处置费及再次销售产生的合理价差，并应扣除货物可回收价值、再次销售所得和因订单取消而避免发生的费用。本站应采取合理措施防止损失扩大。</li>
              <li>因本站迟延履行、错误交付、产品质量问题、双方确认的订单错误，或者采购方依法、依约行使解除权而取消的，不适用前述采购方违约责任。</li>
              <li>逾期货款应继续支付。双方已经有效约定逾期付款违约金的，按约定执行，但可依法调整；未作有效约定的，按届时适用的法律和司法规则确定逾期付款损失。合理催收和司法实现债权费用按有效约定及法律规定处理。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">八、质量保证与免责声明</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>我们保证供货渠道合法，并按照订单约定交付相应品牌、货号和规格。原厂质检报告（CoA）或合格证明在厂家提供且订单约定需要时随货或另行提供。</li>
              <li>产品使用前请仔细阅读原厂说明书，按推荐条件操作。</li>
              <li>因客户未按说明书操作、储存条件不符合要求或实验设计原因造成的损失，由客户承担相应责任；产品质量、错误交付或我们依法应负责的原因除外。</li>
              <li>除订单、技术协议或厂家资料明确承诺外，不对特定实验目的、预期结果或科研进度作额外保证。</li>
              <li>在法律允许范围内，双方对可预见的直接实际损失承担责任。对利润损失、研究延期、数据重建等间接损失的限制，不适用于故意或重大过失、人身损害、产品质量法定责任，以及法律规定不得限制或免除责任的情形。</li>
              <li>机构客户经充分提示并接受本条款的，除前述除外情形外，我们就单一订单承担的累计责任以该订单金额为限；另有书面约定或法律另有规定的，从其约定或规定。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">九、知识产权</h2>
            <ul className="list-disc pl-5 text-sm text-gray-600 space-y-1.5">
              <li>产品品牌、注册商标及包装设计版权归各品牌厂家或授权人所有。</li>
              <li>本网站内容（产品描述、图片、数据）的版权归南京天放生物科技有限公司所有。</li>
              <li>购买产品不构成任何知识产权的转让或许可。</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">十、隐私与数据保护</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              我们按照《个人信息保护法》和《网络安全法》处理您的个人信息。您的订单信息、联系方式及交易记录仅用于订单处理和客户服务，不会提供给第三方用于商业目的。了解更多，请阅读我们的《隐私政策》。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">十一、不可抗力</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              不可抗力是不能预见、不能避免且不能克服的客观情况。受影响方应及时通知、在合理期限内提供证明并采取措施减少损失，根据影响程度依法部分或全部免除责任。迟延履行后发生不可抗力的，不免除迟延责任。普通缺货、上游涨价或可通过合理替代采购解决的供应变化不当然构成不可抗力；持续影响合同目的时，双方可协商变更或解除未履行部分，并结清相应款项。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">十二、适用法律与争议解决</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              本条款受中华人民共和国法律管辖。如因本合同引起争议，双方应友好协商解决；协商不成时，提交合同签订地有管辖权的人民法院诉讼解决。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">十三、合同文本</h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              本网站上的条款与条件构成双方就相关产品交易达成的完整协议。对于批量采购或定制产品，双方可另行签订书面采购合同，以书面合同条款为准。
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">联系我们</h2>
            <p className="text-sm text-gray-600">
              如对销售条款有任何疑问，请联系：<a href="mailto:sales@libereal.cn" className="text-brand-600 hover:underline">sales@libereal.cn</a>
            </p>
          </section>

        </div>
      </main>

      <SiteFooter />
      <MobileBottomNav />
    </div>
  );
}
