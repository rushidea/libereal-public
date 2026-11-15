'use client';

import { useState } from 'react';

type Line = { name?: string; price?: number; quantity?: number; available?: boolean | null; metadata?: string | null };
function metadata(line: Line): Record<string, unknown> {
  try { return JSON.parse(line.metadata || '{}'); } catch { return {}; }
}

export function CatalogRepricingReview({ inquiryId, quote, onRecorded }: {
  inquiryId: string; quote: { id: string; version: number; items: Line[] }; onRecorded: () => Promise<void>;
}) {
  const [channel, setChannel] = useState('邮件');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const orders = [...new Set(quote.items.filter((line) => line.available !== false)
    .map((line) => metadata(line).repricingOrderId).filter((id): id is string => typeof id === 'string'))];
  if (!orders.length) return null;
  return <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
    <h3 className="font-semibold text-gray-900">原订单价格复核 · 报价第 {quote.version} 版</h3>
    <p className="text-sm text-gray-700">这些订单由客户提交，尚未由 Libereal 接受。请先向客户确认新价格，再登记实际收到的回复。登记后仍需单独审核接受订单。</p>
    {orders.map((orderId) => {
      const lines = quote.items.filter((line) => metadata(line).repricingOrderId === orderId);
      const before = lines.reduce((sum, line) => sum + Number(metadata(line).previousUnitPrice) * Number(line.quantity), 0);
      const after = lines.reduce((sum, line) => sum + Number(line.price) * Number(line.quantity), 0);
      return <div key={orderId} className="space-y-2 border-t border-amber-200 pt-3">
        <a href={`/admin/orders?search=${encodeURIComponent(orderId)}`} className="font-medium underline">原订单 {orderId}</a>
        {lines.map((line, index) => <p key={index} className="text-sm">{line.name} × {line.quantity}：单价 ¥{Number(metadata(line).previousUnitPrice).toFixed(2)} → ¥{Number(line.price).toFixed(2)}</p>)}
        <p className="font-medium">商品金额 ¥{before.toFixed(2)} → ¥{after.toFixed(2)}</p>
        <label className="block text-sm">客户回复渠道<input className="ml-2 rounded border px-2 py-1" value={channel} onChange={(event) => setChannel(event.target.value)} /></label>
        <label className="block text-sm">客户确认记录<textarea className="mt-1 block w-full rounded border p-2" placeholder="填写邮件主题和时间、通话记录位置等可核对的信息" value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        <button disabled={busy !== null || !reference.trim() || !channel.trim()} className="rounded bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-50" onClick={async () => {
          if (!confirm(`已收到客户对原订单 ${orderId} 新商品金额 ¥${after.toFixed(2)} 的明确确认？登记将更新原订单价格，订单仍待 Libereal 审核接受。`)) return;
          setBusy(orderId); setMessage('');
          try {
            const response = await fetch(`/api/inquiries/${inquiryId}/quote/repricing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
              quoteId: quote.id, orderId, proposalHash: metadata(lines[0]).repricingProposalHash,
              responseChannel: channel, responseReference: reference,
            }) });
            const data = await response.json();
            if (!response.ok) { setMessage(data.error || '登记失败'); return; }
            setReference(''); await onRecorded(); setMessage('客户确认已登记，原订单价格已更新，等待 Libereal 审核接受。');
          } catch { setMessage('未取得登记结果，请刷新核对后重试。'); }
          finally { setBusy(null); }
        }}>{busy === orderId ? '正在登记…' : '登记客户确认并更新原订单价格'}</button>
      </div>;
    })}
    {message && <p role="status" className="text-sm text-gray-800">{message}</p>}
  </section>;
}
