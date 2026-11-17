'use client';

import { useState } from 'react';
import { CatalogRepricingFinance } from '@/components/admin/CatalogRepricingFinance';

type Line = { name?: string; leadTime?: string | null; notes?: string | null; price?: number; quantity?: number; available?: boolean | null; metadata?: string | null };
function metadata(line: Line): Record<string, unknown> {
  try { return JSON.parse(line.metadata || '{}'); } catch { return {}; }
}

export function CatalogRepricingReview({ inquiryId, quote, onRecorded }: {
  inquiryId: string; quote: { id: string; version: number; items: Line[] }; onRecorded: () => Promise<void>;
}) {
  const orders = [...new Set(quote.items.filter((line) => line.available !== false)
    .map((line) => metadata(line).repricingOrderId).filter((id): id is string => typeof id === 'string'))];
  if (!orders.length) return null;
  return <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
    <h3 className="font-semibold text-gray-900">原订单价格复核 · 报价第 {quote.version} 版</h3>
    <p className="text-sm text-gray-700">这些订单由客户提交，尚未由 Libereal 接受。请先向客户确认新价格与供货条件，再登记实际收到的回复。登记后仍需单独审核接受订单。</p>
    {orders.map((orderId) => <OrderReview key={`${quote.id}:${orderId}`} inquiryId={inquiryId} quoteId={quote.id} orderId={orderId}
      lines={quote.items.filter((line) => metadata(line).repricingOrderId === orderId)} onRecorded={onRecorded} />)}
  </section>;
}

function OrderReview({ inquiryId, quoteId, orderId, lines, onRecorded }: {
  inquiryId: string; quoteId: string; orderId: string; lines: Line[]; onRecorded: () => Promise<void>;
}) {
  const [channel, setChannel] = useState('邮件');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const info = metadata(lines[0]);
  const before = Number(info.repricingOriginalTotal);
  const after = Number(info.repricingProposedTotal);
  const proposalHash = String(info.repricingProposalHash || '');
  const adjustments = Array.isArray(info.repricingPreservedAdjustments) ? info.repricingPreservedAdjustments as { label: string; amount: number }[] : [];
  const hasAmounts = Number.isFinite(before) && Number.isFinite(after);
  return <div className="space-y-2 border-t border-amber-200 pt-3">
        <a href={`/admin/orders?search=${encodeURIComponent(orderId)}`} className="font-medium underline">原订单 {orderId}</a>
        {lines.map((line, index) => <div key={index} className="text-sm">
          <p>{line.name} × {line.quantity}：单价 ¥{Number(metadata(line).previousUnitPrice).toFixed(2)} → ¥{Number(line.price).toFixed(2)}</p>
          <p>货期：{String(metadata(line).previousLeadTime || '未记录')} → {line.leadTime || '未记录'}</p>
          <p>原供货条件：{String(metadata(line).previousNotes || '未记录')}</p>
          <p>本次供货条件：{line.notes || '未记录'}</p>
        </div>)}
        {hasAmounts ? <p className="font-medium">完整应付金额 ¥{before.toFixed(2)} → ¥{after.toFixed(2)}</p> : <p role="status">未取得完整应付金额，请刷新核对，暂不能登记确认。</p>}
        {adjustments.length > 0 && <p className="text-sm">上面的应付金额已保留原有金额调整：{adjustments.map((row) => `${row.label} ¥${row.amount.toFixed(2)}`).join('；')}。仍需财务核对。</p>}
        <label className="block text-sm">客户回复渠道<input className="ml-2 rounded border px-2 py-1" value={channel} onChange={(event) => setChannel(event.target.value)} /></label>
        <label className="block text-sm">客户确认记录<textarea className="mt-1 block w-full rounded border p-2" placeholder="填写邮件主题和时间、通话记录位置等可核对的信息" value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        <button disabled={busy || !hasAmounts || !reference.trim() || !channel.trim()} className="rounded bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-50" onClick={async () => {
          if (!confirm(`已收到客户对原订单 ${orderId} 完整应付金额 ¥${after.toFixed(2)}、货期与供货条件的明确确认？有付款、积分或其他金额调整时，登记后还要进行财务核对。订单仍待 Libereal 审核接受。`)) return;
          setBusy(true); setMessage('');
          try {
            const response = await fetch(`/api/inquiries/${inquiryId}/quote/repricing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
              quoteId, orderId, proposalHash, confirmedTotal: after,
              responseChannel: channel, responseReference: reference,
            }) });
            const data = await response.json();
            if (!response.ok) { setMessage(data.error || '登记失败'); return; }
            if (!['applied', 'awaiting_finance_review'].includes(data.result?.stage)
              || data.result?.orderId !== orderId || data.result?.quoteId !== quoteId || data.result?.proposalHash !== proposalHash) {
              setMessage('返回结果与本次复核不一致，请刷新核对。'); return;
            }
            setReference(''); await onRecorded();
            setMessage(data.result?.stage === 'awaiting_finance_review'
              ? '客户回复已保存，等待财务核对。原订单金额尚未更新。'
              : '客户确认已登记，原订单价格已更新，等待 Libereal 审核接受。');
          } catch { setMessage('未取得登记结果，请刷新核对后重试。'); }
          finally { setBusy(false); }
        }}>{busy ? '正在登记…' : '登记客户对金额与供货条件的确认'}</button>
    {message && <p role="status" className="text-sm text-gray-800">{message}</p>}
    <CatalogRepricingFinance inquiryId={inquiryId} quoteId={quoteId} orderId={orderId} proposalHash={proposalHash} onRecorded={onRecorded} />
  </div>;
}
