'use client';

import { useEffect, useState } from 'react';

type Detail = { productId: string; variantId: string | null; brand: string; catalogNumber: string; name: string; field: string; before: number | null; after: number; unit?: 'rate' };
const valueLabel = (value: number | null, row: Detail) => value == null ? '未设置'
  : row.unit === 'rate' ? `${Number((value * 100).toPrecision(15))}%` : `¥${value.toFixed(2)}`;
export function PricingAdjustmentDetails({ approvalHash }: { approvalHash: string }) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; rows: Detail[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/admin/pricing-adjustments/preview/details?approvalHash=${approvalHash}&offset=${offset}`, { signal: controller.signal })
      .then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.error || '明细读取失败'); return value; })
      .then((value) => { if (!controller.signal.aborted) setData(value); }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '明细读取失败'); });
    return () => controller.abort();
  }, [open, approvalHash, offset]);
  const changePage = (next: number) => { setData(null); setError(''); setOffset(next); };
  return <>
    <button type="button" className="text-sm text-brand-600 underline" onClick={() => { setData(null); setError(''); setOpen(true); }}>查看全部具体变更</button>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="pricing-details-title" onKeyDown={(event) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key === 'Tab') {
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
        const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <section className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl bg-white p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between"><h2 id="pricing-details-title" className="font-semibold">本次预览的完整变更明细</h2><button type="button" autoFocus onClick={() => setOpen(false)} className="rounded border px-3 py-1">关闭</button></div>
        {error ? <p role="alert">{error}</p> : !data ? <p>正在读取…</p> : <>
          <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">品牌 / 货号</th><th className="p-2">商品</th><th className="p-2">价格项目</th><th className="p-2">原值</th><th className="p-2">新值</th></tr></thead><tbody>
            {data.rows.map((row, index) => <tr key={`${row.productId}:${row.variantId}:${index}`} className="border-t"><td className="p-2">{row.brand} / {row.catalogNumber}</td><td className="p-2">{row.name}</td><td className="p-2">{row.field}</td><td className="p-2">{valueLabel(row.before, row)}</td><td className="p-2">{valueLabel(row.after, row)}</td></tr>)}
          </tbody></table></div>
          <div className="mt-3 flex items-center justify-between text-sm"><button type="button" disabled={offset === 0} onClick={() => changePage(Math.max(0, offset - 100))}>上一页</button><span>共 {data.total} 项，当前 {data.total ? offset + 1 : 0}–{Math.min(offset + 100, data.total)}</span><button type="button" disabled={offset + 100 >= data.total} onClick={() => changePage(offset + 100)}>下一页</button></div>
        </>}
      </section>
    </div>}
  </>;
}
