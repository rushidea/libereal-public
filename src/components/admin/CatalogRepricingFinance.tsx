'use client';

import { useState } from 'react';
import { isAdminMfaStepUpResponse, useAdminMfaStepUp } from '@/components/admin/AdminMfaStepUpDialog';

type Preview = {
  stage: 'awaiting_customer_response' | 'awaiting_finance_review';
  financeApprovalHash: string; blocker: string | null; originalTotal: number;
  amounts: { subtotal: number; adjustmentTotal: number; total: number };
  customerEmail: string; paymentMethod: string | null; originalPaidAt: string | null;
  verifiedPaidAmount: number | null;
  customerResponse: { ownerEmail: string; responseChannel: string; responseReference: string } | null;
  adjustments: { id: string; label: string; amount: number }[];
  paymentAttempts: { id: string; outTradeNo: string; amount: number; status: string; tradeNo: string | null }[];
  points: { personal: number; group: number; discount: number; applied: boolean; refundedPersonal: number; refundedGroup: number; refundedCash: number };
  pointsEvidence: { personal: { id: string; delta: number; reason: string | null }[]; group: { id: string; delta: number; reason: string | null }[]; recordedNet: { personal: number; group: number } };
};
const blockers: Record<string, string> = {
  CUSTOMER_REPRICING_CONFIRMATION_REQUIRED: '先登记客户对本版完整金额的确认，再进行财务核对。',
  REPRICING_PAYMENT_RECONCILIATION_REQUIRED: '原交易仍有支付或核对事项。取得实际结果后，刷新本页重新核对。',
  REPRICING_CASH_RESULT_REQUIRED: '收款来源尚不能核实，或实际收款与新金额存在差额。差额处理及结果回填尚未接通，订单继续等待，不能确认完成。',
  REPRICING_POINTS_RECONCILIATION_REQUIRED: '积分标记与流水不一致、尚未结清或已有退还记录。相关结果的接续尚未接通，订单继续等待。',
};
function money(value: number) { return `¥${value.toFixed(2)}`; }
function paymentStatus(status: string) {
  return ({ created: '已创建，待支付', redirected: '已跳转，待结果', WAIT_BUYER_PAY: '等待付款', TRADE_CLOSED: '交易已关闭', closed: '已关闭', failed: '失败', paid: '已付款' } as Record<string, string>)[status] || '待核对';
}

export function CatalogRepricingFinance({ inquiryId, quoteId, orderId, proposalHash, onRecorded }: {
  inquiryId: string; quoteId: string; orderId: string; proposalHash: string; onRecorded: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState('');
  const [preserve, setPreserve] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const { begin, dialog } = useAdminMfaStepUp();
  const endpoint = `/api/inquiries/${encodeURIComponent(inquiryId)}/quote/repricing/finance`;
  const identity = { quoteId, orderId, proposalHash };

  async function load() {
    setBusy(true); setMessage(''); setPreview(null); setPreserve(false);
    try {
      const response = await fetch(`${endpoint}?${new URLSearchParams(identity)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        setMessage(response.status === 403 ? '需要有财务权限的工作人员核对，客户回复记录会保留。' : data.error || '未取得财务核对内容');
        return;
      }
      if (data.preview?.stage === 'applied') { setMessage('本版价格已更新，订单仍需单独审核接受。'); await onRecorded(); return; }
      setPreview(data.preview);
    } catch { setMessage('未取得财务核对结果，请重新读取。'); }
    finally { setBusy(false); }
  }

  // Capture the displayed content and reason before MFA. A refreshed preview must
  // never silently replace the human's earlier approval.
  async function approve(approvedHash: string, approvedReason: string, stepUpToken?: string) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        ...identity, financeApprovalHash: approvedHash, preserveOriginalAdjustments: true,
        reason: approvedReason, stepUpToken,
      }) });
      const data = await response.json();
      if (!stepUpToken && isAdminMfaStepUpResponse(response.status, data.error)) {
        await begin(async (token) => approve(approvedHash, approvedReason, token));
        return;
      }
      if (!response.ok) { setMessage(data.error || '财务确认失败'); return; }
      if (data.result?.stage !== 'applied' || data.result.financeApprovalHash !== approvedHash
        || data.result?.orderId !== orderId || data.result?.quoteId !== quoteId || data.result?.proposalHash !== proposalHash) {
        setMessage('返回结果与本次确认不一致，请重新读取核对。'); return;
      }
      setPreview(null); setMessage('财务核对已完成，原订单价格已更新，等待 Libereal 审核接受。'); await onRecorded();
    } catch { setMessage('未取得确认结果，请重新读取核对后再操作。'); }
    finally { setBusy(false); }
  }

  return <div className="space-y-3 rounded border border-gray-200 bg-white p-3">
    <button type="button" disabled={busy} onClick={load} className="text-sm font-medium text-brand-700 underline disabled:opacity-50">{busy ? '正在处理…' : '查看客户回复及财务核对内容'}</button>
    {preview && <>
      <p className="text-sm">客户：{preview.customerEmail}；付款方式：{preview.paymentMethod || '原订单未填写'}；原订单{preview.originalPaidAt ? '已登记收款' : '未登记收款'}。</p>
      <p className="text-sm">可核对的原交易收款：{preview.verifiedPaidAmount === null ? '尚无可确认的单笔收款' : money(preview.verifiedPaidAmount)}。</p>
      {preview.customerResponse && <p className="text-sm">回复登记人：{preview.customerResponse.ownerEmail}；渠道：{preview.customerResponse.responseChannel}；记录：{preview.customerResponse.responseReference}</p>}
      <p className="font-medium">原应付 {money(preview.originalTotal)} → 新应付 {money(preview.amounts.total)}</p>
      <p className="text-sm">新商品金额 {money(preview.amounts.subtotal)}，保留原有费用、优惠和积分抵扣合计 {money(preview.amounts.adjustmentTotal)}。</p>
      <ul className="list-inside list-disc text-sm">{preview.adjustments.map((row) => <li key={row.id}>{row.label}：{money(row.amount)}</li>)}</ul>
      <p className="text-sm">原积分：个人 {preview.points.personal}，课题组 {preview.points.group}，抵扣 {money(preview.points.discount)}，{preview.points.applied ? '已扣减' : '未扣减'}。已退积分：个人 {preview.points.refundedPersonal}，课题组 {preview.points.refundedGroup}。</p>
      <p className="text-sm">按原订单流水核对的积分占用：个人 {preview.pointsEvidence.recordedNet.personal}，课题组 {preview.pointsEvidence.recordedNet.group}。</p>
      {[...preview.pointsEvidence.personal, ...preview.pointsEvidence.group].length > 0 && <ul className="list-inside list-disc text-sm">
        {preview.pointsEvidence.personal.map((row) => <li key={`personal-${row.id}`}>个人积分 {row.delta > 0 ? '+' : ''}{row.delta}；{row.reason || '原记录未填写说明'}；记录 {row.id}</li>)}
        {preview.pointsEvidence.group.map((row) => <li key={`group-${row.id}`}>课题组积分 {row.delta > 0 ? '+' : ''}{row.delta}；{row.reason || '原记录未填写说明'}；记录 {row.id}</li>)}
      </ul>}
      {preview.paymentAttempts.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="text-left font-medium">原支付记录</caption>
        <thead><tr><th scope="col">交易单号</th><th scope="col">金额</th><th scope="col">结果</th></tr></thead>
        <tbody>{preview.paymentAttempts.map((row) => <tr key={row.id}><td>{row.outTradeNo}</td><td>{money(row.amount)}</td><td>{paymentStatus(row.status)}</td></tr>)}</tbody>
      </table></div>}
      {preview.blocker ? <p role="status" className="text-sm text-amber-800">{blockers[preview.blocker] || '还有未完成的金额核对事项，暂不能确认。'}</p> : <>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={preserve} onChange={(event) => setPreserve(event.target.checked)} />已核对上述原费用、优惠和积分抵扣，本次保持其金额；本次确认只更新订单价格，不执行付款、退款或积分增减。</label>
        <label className="block text-sm">财务核对说明<textarea className="mt-1 block w-full rounded border p-2" maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <button type="button" disabled={busy || !preserve || !reason.trim()} className="rounded bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-50" onClick={() => {
          if (confirm(`确认原订单 ${orderId} 的新应付金额为 ${money(preview.amounts.total)}，并保留页面所列原有金额调整？`)) void approve(preview.financeApprovalHash, reason.trim());
        }}>确认本版金额并更新原订单</button>
      </>}
    </>}
    {message && <p role="status" className="text-sm text-gray-800">{message}</p>}
    {dialog}
  </div>;
}
