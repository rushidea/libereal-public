'use client';

import { useEffect, useRef, useState } from 'react';
import type { PriceAdjustmentPreview } from '@/lib/pricing-adjustment-service';
import { isAdminMfaStepUpResponse, useAdminMfaStepUp } from './AdminMfaStepUpDialog';
import { PricingAdjustmentDetails } from './PricingAdjustmentDetails';
import { resumeConfirmedPricingApplication } from '@/lib/pricing-confirmation-refresh';

type Draft = { target: 'brand_default_discount'; brand: string; brandDefaultDiscountRate: number;
  supplierQuoteRequiredAbove?: number | null; reason: string };
type Result = PriceAdjustmentPreview & {
  updatedCount: number;
  recovered?: boolean;
  repricedQuotes: Array<{ inquiryId: string; version: number; subtotal: number; pendingOrderIds: string[] }>;
};
const percent = (value: number) => `${Number((value * 100).toPrecision(15))}%`;

/** Uses the same pricing approval, permissions, audit and repricing endpoints. */
export function BrandDefaultDiscountForm({ brand }: { brand: string }) {
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const [limitMode, setLimitMode] = useState<'keep' | 'set' | 'clear'>('keep');
  const [quoteLimit, setQuoteLimit] = useState('');
  const [preview, setPreview] = useState<PriceAdjustmentPreview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const frozen = useRef<(Draft & { approvalHash: string }) | null>(null);
  const revision = useRef(0);
  const mounted = useRef(true);
  const { begin, dialog } = useAdminMfaStepUp();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function invalidate() {
    revision.current++;
    frozen.current = null;
    setPreview(null); setResult(null); setError('');
  }
  async function createPreview(draft: Draft, expectedRevision: number, token?: string) {
    if (!mounted.current || revision.current !== expectedRevision) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/pricing-adjustments/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, ...(token ? { stepUpToken: token } : {}) }),
      });
      const data = await response.json();
      if (!mounted.current || revision.current !== expectedRevision) return;
      if (!token && isAdminMfaStepUpResponse(response.status, data.error)) {
        await begin((grant) => createPreview(draft, expectedRevision, grant)); return;
      }
      if (!response.ok) throw new Error(data.error || '预览失败');
      if (!data.preview?.approvalHash || !data.preview.brandDefaultChange) throw new Error('未取得完整品牌折扣预览');
      frozen.current = { ...draft, approvalHash: data.preview.approvalHash };
      setPreview(data.preview);
    } catch (cause) {
      if (mounted.current && revision.current === expectedRevision) setError(cause instanceof Error ? cause.message : '预览失败');
    } finally { if (mounted.current && revision.current === expectedRevision) setBusy(false); }
  }
  async function apply(expectedHash: string, token?: string) {
    const approved = frozen.current;
    if (!mounted.current || !approved || approved.approvalHash !== expectedHash) return;
    const stillCurrent = () => mounted.current && frozen.current === approved;
    setBusy(true); setError('');
    try {
      const response = token ? await resumeConfirmedPricingApplication(approved, token, stillCurrent) : await fetch('/api/admin/pricing-adjustments/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...approved, ...(token ? { stepUpToken: token } : {}) }),
      });
      if (!response) return;
      const data = await response.json();
      if (!stillCurrent()) return;
      if (!token && isAdminMfaStepUpResponse(response.status, data.error)) {
        await begin((grant) => apply(expectedHash, grant)); return;
      }
      if (!response.ok) throw new Error(data.error || '品牌折扣未能生效');
      if (data.result?.approvalHash !== expectedHash || !Array.isArray(data.result.repricedQuotes)
        || typeof data.result.updatedCount !== 'number') throw new Error('未取得本次确认的执行结果，请核对后重试');
      setResult(data.result);
    } catch (cause) {
      if (stillCurrent()) setError(cause instanceof Error ? cause.message : '执行失败');
    } finally { if (mounted.current) setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
    <div><h2 className="font-semibold">品牌全店默认折扣</h2>
      <p className="mt-1 text-sm text-gray-600">客户专属折扣优先，其次为客户等级折扣；均不适用时，使用该品牌的全店默认折扣。按目录价计算，不叠加、不自动取最低价。</p></div>
    {!brand ? <p className="text-sm text-gray-600">先在上方选择一个品牌，再填写已核实的默认折扣。</p> : <>
      <p className="text-sm">品牌：<strong>{brand}</strong></p>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">按目录价的百分比
          <input aria-label="品牌默认折扣百分比" type="number" min="0" max="100" step="any" value={rate} disabled={busy}
            onChange={(event) => { invalidate(); setRate(event.target.value); }}
            className="ml-2 w-28 rounded border p-2" placeholder="例如 80" /> %
        </label>
        <label className="text-sm">确认依据
          <input aria-label="品牌折扣确认依据" value={reason} maxLength={200} disabled={busy}
            onChange={(event) => { invalidate(); setReason(event.target.value); }}
            className="ml-2 rounded border p-2" placeholder="资料来源及调整原因" />
        </label>
        <label className="text-sm">供应商书面询价
          <select aria-label="供应商书面询价规则" value={limitMode} disabled={busy}
            onChange={(event) => { invalidate(); setLimitMode(event.target.value as 'keep' | 'set' | 'clear'); }} className="ml-2 rounded border p-2">
            <option value="keep">保留现有门槛</option>
            <option value="set">超过指定目录价先人工询价</option>
            <option value="clear">取消金额门槛</option>
          </select>
        </label>
        {limitMode === 'set' && <label className="text-sm">单个销售包装目录价超过
          <input aria-label="供应商询价目录价门槛" type="number" min="0.01" max="1000000000" step="0.01"
            value={quoteLimit} disabled={busy} onChange={(event) => { invalidate(); setQuoteLimit(event.target.value); }}
            className="ml-2 w-32 rounded border p-2" /> 元
        </label>}
        <button type="button" disabled={busy || !rate || Number(rate) <= 0 || Number(rate) > 100 || reason.trim().length < 2
          || (limitMode === 'set' && (!Number.isFinite(Number(quoteLimit)) || Number(quoteLimit) <= 0 || Number(quoteLimit) > 1_000_000_000))}
          className="rounded border px-3 py-2 text-sm disabled:opacity-50"
          onClick={() => { invalidate(); void createPreview({ target: 'brand_default_discount', brand, brandDefaultDiscountRate: Number(rate) / 100,
            ...(limitMode === 'set' ? { supplierQuoteRequiredAbove: Number(quoteLimit) } : limitMode === 'clear' ? { supplierQuoteRequiredAbove: null } : {}),
            reason: reason.trim() }, revision.current); }}>
          {busy ? '正在处理…' : '预览品牌折扣变更'}
        </button>
      </div>
      {preview?.brandDefaultChange && <div className="space-y-2 rounded border border-brand-200 p-3 text-sm">
        <p>{preview.brandDefaultChange.brandName}：{preview.brandDefaultChange.beforeRate == null ? '未确认' : percent(preview.brandDefaultChange.beforeRate)} → <strong>{percent(preview.brandDefaultChange.afterRate)}</strong></p>
        <p>供应商书面询价门槛：{preview.brandDefaultChange.beforeQuoteLimit == null ? '未设置' : `¥${preview.brandDefaultChange.beforeQuoteLimit.toFixed(2)}`}
          {' → '}{preview.brandDefaultChange.afterQuoteLimit == null ? '不设金额门槛' : `单个销售包装目录价超过 ¥${preview.brandDefaultChange.afterQuoteLimit.toFixed(2)} 时，先人工发函并核验供应商回复，再继续报价`}</p>
        <p>预计复核 {preview.quoteImpact?.quoteCount ?? 0} 份未锁价报价、{preview.quoteImpact?.pendingOrderCount ?? 0} 笔待接受订单。已由 Libereal 接受的订单保留原价。</p>
        <PricingAdjustmentDetails key={preview.approvalHash} approvalHash={preview.approvalHash!} />
        {!result && <div><button type="button" disabled={busy || !preview.changeCount}
          className="rounded bg-brand-600 px-3 py-2 text-white disabled:opacity-50"
          onClick={() => { if (preview.approvalHash) void apply(preview.approvalHash); }}>确认所示变更并处理受影响报价</button></div>}
      </div>}
      {result && <div role="status" className="space-y-2 text-sm">
        <p>{result.recovered ? '已核实此前品牌折扣变更成功，本次没有重复改写。' : '品牌默认折扣已与本次确认一致。'}{result.repricedQuotes.length ? '已生成以下报价复核，需按原流程审核及取得客户回复。' : '本次没有需要改变成交金额的未锁价报价。'}</p>
        {result.repricedQuotes.map((quote) => <p key={quote.inquiryId}>
          <a className="text-brand-600 underline" href={`/admin/inquiries?inquiryId=${encodeURIComponent(quote.inquiryId)}`}>打开原询价的第 {quote.version} 版报价</a>
          {' · '}¥{quote.subtotal.toFixed(2)}{quote.pendingOrderIds.length > 0 ? ` · ${quote.pendingOrderIds.length} 笔待接受订单需接续复核` : ''}
        </p>)}
      </div>}
    </>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {dialog}
  </section>;
}
