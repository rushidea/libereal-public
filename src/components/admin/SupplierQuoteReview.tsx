'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDateTimeSafe } from '@/lib/admin-inquiry-timeline';
import type { SupplierQuoteReply } from '@/lib/supplier-quote-review';
import { getCloudMailUrl } from '@/lib/cloud-mail';

export type SupplierQuoteEntry = {
  inquiryItemId: string;
  name: string;
  error?: string;
  scope?: {
    catalogNumber: string;
    brand: string;
    quantity: number;
    cataloguePrice: number;
    currency?: string;
    customerPricing: { finalPrice: number; steps: { reason: string }[] };
  };
  quantityChangeSource?: { quoteId: string; quoteHash: string } | null;
  reviewId?: string | null;
  requestHash?: string | null;
  status?: string;
  owner?: string | null;
  requestedAt?: string | null;
  confirmedAt?: string | null;
  reply?: SupplierQuoteReply | null;
  mailReceipts?: { receiptId: string; emailId: number; sender: string }[];
  hasMoreMailReceipts?: boolean;
  continuation?: { status: string; reason: string; inquiryItemId: string } | unknown[] | null;
};

type SupplierQuoteReviewProps = {
  inquiryId: string;
  onRecorded: () => Promise<void>;
  entries?: SupplierQuoteEntry[];
  loading?: boolean;
  error?: string;
  onEntriesChange?: (entries: SupplierQuoteEntry[]) => Promise<void> | void;
  compactWhenComplete?: boolean;
  compactLayout?: boolean;
};

const statuses: Record<string, string> = {
  not_prepared: '待准备询价', awaiting_human: '等待人工询价回复', succeeded: '回复已核对',
  expired: '回复已过期，需重新询价', source_changed: '商品或条件已变化，需重新核对',
};

/** A hand-back into the original inquiry; correspondence is separately previewed and approved. */
export function SupplierQuoteReview({
  inquiryId,
  onRecorded,
  entries: controlledEntries,
  loading: controlledLoading,
  error: controlledError,
  onEntriesChange,
  compactWhenComplete = false,
  compactLayout = false,
}: SupplierQuoteReviewProps) {
  const isControlled = controlledEntries !== undefined;
  const [internalEntries, setInternalEntries] = useState<SupplierQuoteEntry[]>([]);
  const [internalError, setInternalError] = useState('');
  const [internalLoading, setInternalLoading] = useState(!isControlled);
  useEffect(() => {
    if (isControlled) return;
    let active = true;
    fetch(`/api/inquiries/${inquiryId}/supplier-quote`).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '未能读取供应商询价记录');
      if (!Array.isArray(body.entries)) throw new Error('未取得有效的供应商询价记录，请刷新后重试');
      if (active) setInternalEntries(body.entries);
    }).catch(err => { if (active) setInternalError(err.message); }).finally(() => { if (active) setInternalLoading(false); });
    return () => { active = false; };
  }, [inquiryId, isControlled]);

  const entries = isControlled ? controlledEntries : internalEntries;
  const loading = isControlled ? Boolean(controlledLoading) : internalLoading;
  const error = isControlled ? (controlledError ?? '') : internalError;

  if (loading) return <p className="text-sm text-gray-600" role="status">正在核对供应商询价条件…</p>;
  if (error) return <p className="text-sm text-red-700" role="alert">{error}</p>;
  if (!entries.length) return null;

  const allCompleteAndClean = compactWhenComplete && entries.every(
    entry => entry.status === 'succeeded' && !entry.error && !entry.quantityChangeSource,
  );

  const handleSaved = async (next: SupplierQuoteEntry[]) => {
    if (isControlled) {
      await onEntriesChange?.(next);
    } else {
      setInternalEntries(next);
    }
    await onRecorded();
  };

  const entryList = entries.map(entry => (
    <SupplierReplyForm
      key={`${entry.inquiryItemId}:${entry.scope?.quantity}:${entry.reviewId}:${entry.status}`}
      entry={entry}
      inquiryId={inquiryId}
      compactLayout={compactLayout}
      onSaved={handleSaved}
    />
  ));

  if (allCompleteAndClean) {
    return (
      <section aria-label="供应商书面询价" className="min-w-0 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <details>
          <summary className="cursor-pointer font-semibold text-gray-900">
            供应商书面询价（{entries.length} 项均已核对完成 · 点击展开重新询价）
          </summary>
          <div className="mt-3 space-y-3 min-w-0">
            <p className="text-sm text-gray-700">以下包装符合品牌已确认的询价条件。由负责人通过现有渠道联系供应商，取得书面回复后，在这里核对并接续原询价。</p>
            {entryList}
          </div>
        </details>
      </section>
    );
  }

  return <section aria-label="供应商书面询价" className="min-w-0 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
    <h3 className="font-semibold text-gray-900">供应商书面询价</h3>
    <p className="text-sm text-gray-700">以下包装符合品牌已确认的询价条件。由负责人通过现有渠道联系供应商，取得书面回复后，在这里核对并接续原询价。</p>
    {entryList}
  </section>;
}

function SupplierReplyForm({ entry, inquiryId, compactLayout = false, onSaved }: { entry: SupplierQuoteEntry; inquiryId: string; compactLayout?: boolean; onSaved: (entries: SupplierQuoteEntry[]) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [renewalReason, setRenewalReason] = useState('');
  const [requestedQuantity, setRequestedQuantity] = useState(String(entry.scope?.quantity ?? ''));
  const [quantityChannel, setQuantityChannel] = useState('');
  const [quantityReference, setQuantityReference] = useState('');
  const [form, setForm] = useState({ supplier: '', channel: '', reference: '', supplierUnitPrice: '',
    taxBasis: '', leadTime: '', validUntil: '', conditions: '', customerConditions: '' });
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
  if (entry.error) return <p className="text-sm text-amber-900 break-words">{entry.name}：{entry.error}</p>;
  if (!entry.scope) return null;
  const scope = entry.scope;
  const inputClass = 'w-full min-w-0 max-w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm';
  const gridClass = `grid min-w-0 gap-3 ${compactLayout ? 'grid-cols-1' : 'sm:grid-cols-2'}`;
  const fullSpanClass = compactLayout ? '' : 'sm:col-span-2';
  const fields = [
    ['supplier', '回复供应商'], ['channel', '沟通渠道'], ['reference', '书面回复依据（邮件编号、链接或归档记录）'],
    ['supplierUnitPrice', '供应商每包报价（元）'],
    ['leadTime', '确认货期'], ['validUntil', '供应商报价有效期'],
  ] as const;
  return <div className="min-w-0 space-y-3 rounded border border-amber-200 bg-white p-4">
    <p className="text-sm font-medium break-all">{scope.brand} · {scope.catalogNumber} · {scope.quantity} 包</p>
    {entry.reviewId && entry.status === 'awaiting_human' && <Link className="inline-block text-sm text-brand-600 underline break-words" href={`/admin/business-letters?reviewId=${encodeURIComponent(entry.reviewId)}&reference=${encodeURIComponent(inquiryId)}`}>选用模板准备询价函</Link>}
    <p className="text-sm text-gray-700 break-words">每包目录价 ¥{scope.cataloguePrice.toFixed(2)} · {statuses[entry.status ?? ''] || '待核对'}{entry.owner ? <> · 负责人：<span className="break-all">{entry.owner}</span></> : ''}</p>
    <p className="text-sm text-gray-700 break-words">客户每包售价 ¥{scope.customerPricing.finalPrice.toFixed(2)} · {scope.customerPricing.steps.at(-1)?.reason}。供应商采购报价单独记录。</p>
    {error && <p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
    {entry.reply && <p className="text-sm text-gray-700 break-all">已记录 {entry.reply.supplier} 的回复：供应商单价 ¥{entry.reply.supplierUnitPrice.toFixed(2)}，本次客户单价 ¥{entry.reply.customerUnitPrice.toFixed(2)}；有效期至 {formatDateTimeSafe(entry.reply.validUntil)}。货期：{entry.reply.leadTime}；客户供货条件：{entry.reply.customerConditions}。</p>}
    {entry.reply && entry.continuation && !Array.isArray(entry.continuation) && entry.continuation.status === 'awaiting_pricing_review' && <div role="status" className="min-w-0 space-y-2 text-sm text-amber-900">
      <p className="break-words">供应商回复已保存，报价准备仍待补齐商品资料：{entry.continuation.reason}。</p>
      <button type="button" disabled={busy} className="rounded border px-3 py-2 disabled:opacity-50"
        onClick={() => send({ action: 'record_reply', reviewId: entry.reviewId, requestHash: entry.requestHash, reply: entry.reply })}>资料已补齐，继续准备报价</button>
    </div>}
    {entry.status !== 'awaiting_human' && <div className="flex min-w-0 flex-wrap items-end gap-3">
      {entry.status === 'succeeded' && <label className="min-w-0 space-y-1 text-sm">重新询价原因
        <input className={inputClass} value={renewalReason} maxLength={500} disabled={busy} onChange={event => setRenewalReason(event.target.value)} />
      </label>}
      <button type="button" disabled={busy || (entry.status === 'succeeded' && !renewalReason.trim())}
        className="rounded border border-gray-400 px-3 py-2 text-sm disabled:opacity-50"
        onClick={() => send({ action: 'prepare', inquiryItemId: entry.inquiryItemId, quantity: scope.quantity,
          ...(renewalReason.trim() ? { renewalReason: renewalReason.trim() } : {}) })}>
        {entry.status === 'not_prepared' ? '由我负责，准备询价' : '重新准备询价'}
      </button>
    </div>}
    {entry.quantityChangeSource && <details className="min-w-0 text-sm">
      <summary className="cursor-pointer font-medium">客户提出了新的数量</summary>
      <div className={`mt-3 ${gridClass}`}>
        <label className="min-w-0 space-y-1 text-sm">本次询价数量（包）<input type="number" min="1" step="1" className={inputClass} value={requestedQuantity}
          disabled={busy} onChange={event => setRequestedQuantity(event.target.value)} /></label>
        <label className="min-w-0 space-y-1 text-sm">客户沟通渠道<input className={inputClass} value={quantityChannel} maxLength={200}
          disabled={busy} onChange={event => setQuantityChannel(event.target.value)} /></label>
        <label className={`min-w-0 space-y-1 text-sm ${fullSpanClass}`}>客户提出新数量的记录<textarea className={inputClass} value={quantityReference} maxLength={2000}
          disabled={busy} onChange={event => setQuantityReference(event.target.value)} /></label>
        <button type="button" className={`rounded border border-gray-400 px-3 py-2 disabled:opacity-50 ${fullSpanClass}`}
          disabled={busy || !Number.isInteger(Number(requestedQuantity)) || Number(requestedQuantity) <= 0 || Number(requestedQuantity) === scope.quantity || !quantityChannel.trim() || !quantityReference.trim()}
          onClick={() => {
            if (!confirm(`登记客户的新需求：${scope.quantity} 包改为 ${requestedQuantity} 包。\n依据：${quantityChannel}／${quantityReference}\n将保留原报价与回复，生成新数量的询价和报价草稿，等待供应商重新确认。`)) return;
            void send({ action: 'prepare', inquiryItemId: entry.inquiryItemId, quantity: Number(requestedQuantity),
              quantityChange: { ...entry.quantityChangeSource, fromQuantity: scope.quantity, channel: quantityChannel.trim(), reference: quantityReference.trim() } });
          }}>登记新数量，重新准备询价</button>
      </div>
    </details>}
    {entry.status === 'awaiting_human' && <>
      {Boolean(entry.mailReceipts?.length) && <div className="min-w-0 space-y-2 border-t border-amber-200 pt-3 text-sm text-gray-800">
        <p>已关联邮件头。请到邮箱核对原信；关联不代表供应商回复已确认。</p>
        <ul className="space-y-2">
          {entry.mailReceipts?.map(mail => <li key={mail.receiptId} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <a className="break-all text-brand-700 underline" href={getCloudMailUrl()}>邮件 #{mail.emailId} · {mail.sender}</a>
            <button type="button" className="rounded border border-gray-400 px-2 py-1 disabled:opacity-50" disabled={busy}
              onClick={() => setForm(current => ({ ...current, channel: '邮件', reference: `Cloud Mail #${mail.emailId}` }))}>引用邮件编号</button>
          </li>)}
        </ul>
        {entry.hasMoreMailReceipts && <Link className="text-brand-700 underline" href="/admin/tasks">还有收件，可在任务与通知中核对</Link>}
      </div>}
      <details className="min-w-0 text-sm"><summary className="cursor-pointer font-medium">发函内容参考</summary>
        <p className="mt-2 whitespace-pre-wrap break-words">请就 {scope.brand} {scope.catalogNumber}，数量 {scope.quantity} 包，提供书面报价和供货确认。请注明每包人民币金额、含税口径、运费及其他费用、有效期、实际货期和付款条件。本函仅为询价，不构成采购或付款承诺。</p>
      </details>
      <form className="min-w-0" onSubmit={event => {
        event.preventDefault();
        const reply = { ...form, currency: 'CNY', supplierUnitPrice: Number(form.supplierUnitPrice),
          customerUnitPrice: scope.customerPricing.finalPrice, validUntil: new Date(form.validUntil).toISOString() };
        if (!confirm(`请核对本次回复：\n${scope.brand} ${scope.catalogNumber} × ${scope.quantity}\n供应商：${reply.supplier}\n依据：${reply.channel}／${reply.reference}\n供应商单价 ¥${reply.supplierUnitPrice}；客户单价 ¥${reply.customerUnitPrice}\n${reply.taxBasis === 'included' ? '含税' : '未税'}；货期：${reply.leadTime}\n有效期：${form.validUntil}\n供应商条件：${reply.conditions}\n向客户报价的供货条件：${reply.customerConditions}\n\n确认后回填原询价并重新核算已有草稿，客户发送和采购审批仍按原流程办理。`)) return;
        void send({ action: 'record_reply', reviewId: entry.reviewId, requestHash: entry.requestHash, reply });
      }}>
        <fieldset disabled={busy} className={gridClass}>
          {fields.map(([key, label]) => <label key={key} className="min-w-0 space-y-1 text-sm">{label}
            <input required className={inputClass} value={form[key]} maxLength={2000}
              type={key.endsWith('UnitPrice') ? 'number' : key === 'validUntil' ? 'datetime-local' : 'text'}
              {...(key.endsWith('UnitPrice') ? { min: '0.01', max: '1000000000', step: '0.01' } : {})}
              onChange={event => setForm({ ...form, [key]: event.target.value })} />
          </label>)}
          <label className="min-w-0 space-y-1 text-sm">供应商报价含税口径
            <select required className={inputClass} value={form.taxBasis} onChange={event => setForm({ ...form, taxBasis: event.target.value })}>
              <option value="">按书面回复选择</option><option value="included">含税</option><option value="excluded">未税</option>
            </select>
          </label>
          <label className={`min-w-0 space-y-1 text-sm ${fullSpanClass}`}>供应商供货、付款及费用条件（内部记录）
            <textarea required maxLength={2000} rows={3} className={inputClass} value={form.conditions} onChange={event => setForm({ ...form, conditions: event.target.value })} />
          </label>
          <label className={`min-w-0 space-y-1 text-sm ${fullSpanClass}`}>向客户报价的供货条件
            <textarea required maxLength={2000} rows={3} className={inputClass} value={form.customerConditions}
              onChange={event => setForm({ ...form, customerConditions: event.target.value })} />
          </label>
          <p className={`text-xs text-gray-600 ${fullSpanClass}`}>客户售价按已确认的折扣规则计算，不能在这里改价。客户供货条件会进入报价，请写明已核实的税费、运费和交付条件；供应商采购价及内部付款条件只在内部记录。</p>
          <button className={`rounded bg-brand-600 px-3 py-2 text-sm text-white disabled:opacity-50 ${fullSpanClass}`} type="submit">{busy ? '正在核对并接续…' : '核对回复与客户报价，接续原询价'}</button>
        </fieldset>
      </form>
    </>}
  </div>;
}
