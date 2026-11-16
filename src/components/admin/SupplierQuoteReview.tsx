'use client';

import { useEffect, useState } from 'react';
import type { SupplierQuoteReply } from '@/lib/supplier-quote-review';

type Entry = {
  inquiryItemId: string; name: string; error?: string;
  scope?: { catalogNumber: string; brand: string; quantity: number; cataloguePrice: number; currency: string };
  reviewId?: string | null; requestHash?: string | null; status?: string; owner?: string | null;
  reply?: SupplierQuoteReply | null;
};
const statuses: Record<string, string> = {
  not_prepared: '待准备询价', awaiting_human: '等待人工询价回复', succeeded: '回复已核对',
  expired: '回复已过期，需重新询价', source_changed: '商品或条件已变化，需重新核对',
};

/** A hand-back into the original inquiry. No supplier send, purchase or payment action. */
export function SupplierQuoteReview({ inquiryId, onRecorded }: { inquiryId: string; onRecorded: () => Promise<void> }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    fetch(`/api/inquiries/${inquiryId}/supplier-quote`).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '未能读取供应商询价记录');
      if (!Array.isArray(body.entries)) throw new Error('未取得有效的供应商询价记录，请刷新后重试');
      if (active) setEntries(body.entries);
    }).catch(err => { if (active) setError(err.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [inquiryId]);
  if (loading) return <p className="text-sm text-gray-600" role="status">正在核对供应商询价条件…</p>;
  if (error) return <p className="text-sm text-red-700" role="alert">{error}</p>;
  if (!entries.length) return null;
  return <section aria-label="供应商书面询价" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
    <h3 className="font-semibold text-gray-900">供应商书面询价</h3>
    <p className="text-sm text-gray-700">以下包装符合品牌已确认的询价条件。由负责人通过现有渠道联系供应商，取得书面回复后，在这里核对并接续原询价。</p>
    {entries.map(entry => <SupplierReplyForm key={`${entry.inquiryItemId}:${entry.scope?.quantity}:${entry.reviewId}:${entry.status}`}
      entry={entry} inquiryId={inquiryId} onSaved={async next => { setEntries(next); await onRecorded(); }} />)}
  </section>;
}

function SupplierReplyForm({ entry, inquiryId, onSaved }: { entry: Entry; inquiryId: string; onSaved: (entries: Entry[]) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [renewalReason, setRenewalReason] = useState('');
  const [form, setForm] = useState({ supplier: '', channel: '', reference: '', supplierUnitPrice: '', customerUnitPrice: '',
    taxBasis: '', leadTime: '', validUntil: '', conditions: '' });
  async function send(body: Record<string, unknown>) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/inquiries/${inquiryId}/supplier-quote`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '处理未完成，请核对后重试');
      if (!Array.isArray(data.entries)) throw new Error('回复可能已保存，但未取得接续状态，请刷新原询价核对');
      await onSaved(data.entries);
    } catch (err) { setError(err instanceof Error ? err.message : '处理未完成'); }
    finally { setBusy(false); }
  }
  if (entry.error) return <p className="text-sm text-amber-900">{entry.name}：{entry.error}</p>;
  if (!entry.scope) return null;
  const scope = entry.scope;
  const inputClass = 'w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm';
  const fields = [
    ['supplier', '回复供应商'], ['channel', '沟通渠道'], ['reference', '书面回复依据（邮件编号、链接或归档记录）'],
    ['supplierUnitPrice', '供应商每包报价（元）'], ['customerUnitPrice', '本次确认的客户每包报价（元）'],
    ['leadTime', '确认货期'], ['validUntil', '供应商报价有效期'],
  ] as const;
  return <div className="space-y-3 rounded border border-amber-200 bg-white p-4">
    <p className="text-sm font-medium">{scope.brand} · {scope.catalogNumber} · {scope.quantity} 包</p>
    <p className="text-sm text-gray-700">每包目录价 ¥{scope.cataloguePrice.toFixed(2)} · {statuses[entry.status ?? ''] || '待核对'}{entry.owner ? ` · 负责人：${entry.owner}` : ''}</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {entry.reply && <p className="text-sm text-gray-700">已记录 {entry.reply.supplier} 的回复：供应商单价 ¥{entry.reply.supplierUnitPrice.toFixed(2)}，本次客户单价 ¥{entry.reply.customerUnitPrice.toFixed(2)}；有效期至 {new Date(entry.reply.validUntil).toLocaleString('zh-CN')}。</p>}
    {entry.status !== 'awaiting_human' && <div className="flex flex-wrap items-end gap-3">
      {entry.status === 'succeeded' && <label className="space-y-1 text-sm">重新询价原因
        <input className={inputClass} value={renewalReason} maxLength={500} disabled={busy} onChange={event => setRenewalReason(event.target.value)} />
      </label>}
      <button type="button" disabled={busy || (entry.status === 'succeeded' && !renewalReason.trim())}
        className="rounded border border-gray-400 px-3 py-2 text-sm disabled:opacity-50"
        onClick={() => send({ action: 'prepare', inquiryItemId: entry.inquiryItemId, quantity: scope.quantity,
          ...(renewalReason.trim() ? { renewalReason: renewalReason.trim() } : {}) })}>
        {entry.status === 'not_prepared' ? '由我负责，准备询价' : '重新准备询价'}
      </button>
    </div>}
    {entry.status === 'awaiting_human' && <>
      <details className="text-sm"><summary className="cursor-pointer font-medium">发函内容参考</summary>
        <p className="mt-2 whitespace-pre-wrap">请就 {scope.brand} {scope.catalogNumber}，数量 {scope.quantity} 包，提供书面报价和供货确认。请注明每包人民币金额、含税口径、运费及其他费用、有效期、实际货期和付款条件。本函仅为询价，不构成采购或付款承诺。</p>
      </details>
      <form onSubmit={event => {
        event.preventDefault();
        const reply = { ...form, currency: 'CNY', supplierUnitPrice: Number(form.supplierUnitPrice),
          customerUnitPrice: Number(form.customerUnitPrice), validUntil: new Date(form.validUntil).toISOString() };
        if (!confirm(`请核对本次回复：\n${scope.brand} ${scope.catalogNumber} × ${scope.quantity}\n供应商：${reply.supplier}\n依据：${reply.channel}／${reply.reference}\n供应商单价 ¥${reply.supplierUnitPrice}；客户单价 ¥${reply.customerUnitPrice}\n${reply.taxBasis === 'included' ? '含税' : '未税'}；货期：${reply.leadTime}\n有效期：${form.validUntil}\n条件：${reply.conditions}\n\n确认后回填原询价并重新核算已有草稿，客户发送和采购审批仍按原流程办理。`)) return;
        void send({ action: 'record_reply', reviewId: entry.reviewId, requestHash: entry.requestHash, reply });
      }}>
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
          {fields.map(([key, label]) => <label key={key} className="space-y-1 text-sm">{label}
            <input required className={inputClass} value={form[key]} maxLength={2000}
              type={key.endsWith('UnitPrice') ? 'number' : key === 'validUntil' ? 'datetime-local' : 'text'}
              {...(key.endsWith('UnitPrice') ? { min: '0.01', max: '1000000000', step: '0.01' } : {})}
              onChange={event => setForm({ ...form, [key]: event.target.value })} />
          </label>)}
          <label className="space-y-1 text-sm">含税口径
            <select required className={inputClass} value={form.taxBasis} onChange={event => setForm({ ...form, taxBasis: event.target.value })}>
              <option value="">按书面回复选择</option><option value="included">含税</option><option value="excluded">未税</option>
            </select>
          </label>
          <label className="space-y-1 text-sm sm:col-span-2">供货、付款及费用条件
            <textarea required maxLength={2000} rows={3} className={inputClass} value={form.conditions} onChange={event => setForm({ ...form, conditions: event.target.value })} />
          </label>
          <p className="text-xs text-gray-600 sm:col-span-2">供应商报价与客户售价分别核对。请把确认的税费、运费及其他费用写清楚；未明确的条件先向供应商确认。</p>
          <button className="rounded bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-50 sm:col-span-2" type="submit">{busy ? '正在核对并接续…' : '核对回复与客户报价，接续原询价'}</button>
        </fieldset>
      </form>
    </>}
  </div>;
}
